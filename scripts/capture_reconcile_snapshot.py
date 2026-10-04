#!/usr/bin/env python3
"""Capture a REAL reconcile_snapshot from the MetaTrader 5 bridge EA.

Standalone, strictly read-only capture tool. It listens on TCP and plays the
Rust side of bridge protocol v1 (docs/protocol/bridge-v1.md): the EA is the
client and connects to us. The first frame must be `hello`; we reply
`hello_ack`, send exactly one `reconcile_request`, answer every `heartbeat`
with `heartbeat_ack`, tolerate (type name only) any other read-only EA
message, and accept the first `reconcile_snapshot` or `reconcile_error` whose
payload request_id equals "capture-reconcile-1".

The raw payload is saved pretty-printed to $MT5_CAPTURE_OUT (default
capture_reconcile_snapshot.json, relative to CWD) plus a sidecar
"<out>.meta.json" with the wall-time capture stamp, the hello identity
(account_login, broker_server, chart_symbol -- never the token), the message
type received and the observed message-type counts. The payload is then
validated against the contract rules mirrored from
crates/trading-core/src/protocol.rs (ReconcileSnapshot::validate,
HistoryOrder::validate, HistoryDeal::validate, ReconcileError::validate);
every rule prints one PASS/FAIL line and the exit status is 0 only if all
rules pass.

Read-only guarantee: this process only ever sends `hello_ack`, one
`reconcile_request` and `heartbeat_ack` frames -- never a trading message.

Framing matches scripts/mock_mt5_bridge.py: 4-byte big-endian length prefix +
JSON UTF-8 payload, explicitly negotiating legacy MAX_FRAME = 1 MiB, envelope
{v, type, id, session_id, sent_at_ms, payload}. The helpers are copied so the
tool stays standalone (no imports from the mock).

Usage:
    python3 scripts/capture_reconcile_snapshot.py --help
    MT5_BRIDGE_PORT=8765 python3 scripts/capture_reconcile_snapshot.py
    MT5_CAPTURE_SELFTEST=1 python3 scripts/capture_reconcile_snapshot.py

Python 3.9+, standard library only.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import socket
import struct
import sys
import time

MAX_FRAME = 1024 * 1024
SESSION_ID = "capture-session-1"
REQUEST_ID = "capture-reconcile-1"
HISTORY_WINDOW_MS = 7 * 24 * 3600 * 1000
MAX_COLLECTION = 500
MAX_HISTORY_LIMIT = 1000
MAX_ID_CHARS = 128
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_TIMEOUT_S = 90.0
DEFAULT_OUT = "capture_reconcile_snapshot.json"

# ^-?[0-9]+(\.[0-9]+)?$ -- no exponent, no whitespace, no thousands separators.
DECIMAL_RE = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")
# Only these cashflow fields may carry a leading '-'.
SIGNED_DECIMAL_FIELDS = frozenset({"profit", "commission", "swap", "fee"})

# (field, class) for every decimal string of the history records.
ORDER_DECIMAL_FIELDS = (
    ("volume_initial", "positive"),
    ("volume_current", "nonnegative"),
    ("price_open", "positive"),
    ("price_current", "nonnegative"),
    ("stop_loss", "optional-positive"),
    ("take_profit", "optional-positive"),
)
DEAL_DECIMAL_FIELDS = (
    ("volume", "positive"),
    ("price", "positive"),
    ("profit", "signed"),
    ("commission", "signed"),
    ("swap", "signed"),
    ("fee", "signed"),
)

USAGE = """\
usage: capture_reconcile_snapshot.py [--help]

Standalone read-only capture of a real reconcile_snapshot (or
reconcile_error) from the MetaTrader 5 bridge EA. The tool listens on TCP,
plays the Rust side of bridge protocol v1 (hello/hello_ack, one
reconcile_request, heartbeat_ack replies), saves the raw payload JSON plus a
"<out>.meta.json" sidecar, and validates the payload against the contract
rules mirrored from crates/trading-core/src/protocol.rs. It never sends
trading messages.

Environment:
  MT5_BRIDGE_HOST        TCP host to listen on (default 127.0.0.1)
  MT5_BRIDGE_PORT        TCP port to listen on (default 8765)
  MT5_CAPTURE_TIMEOUT_S  overall capture timeout in seconds (default 90)
  MT5_BRIDGE_TOKEN       expected hello token; if set, the EA token must
                         match (the token value is never printed)
  MT5_CAPTURE_OUT        output path of the raw payload JSON, relative to
                         CWD (default capture_reconcile_snapshot.json);
                         the sidecar is written to "<out>.meta.json"
  MT5_CAPTURE_SELFTEST   set to 1 to run the in-process loopback self-test

Exit status: 0 = capture succeeded and every contract rule passed;
1 = failure (protocol, timeout, token mismatch, or a failed rule).
"""


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError:
        raise AssertionError(f"{name} must be an integer") from None


def env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    try:
        return float(value)
    except ValueError:
        raise AssertionError(f"{name} must be a number") from None


# --- protocol helpers (copied from scripts/mock_mt5_bridge.py) --------------


class FrameReader:
    def __init__(self, conn: socket.socket) -> None:
        self.conn = conn
        self.buffer = bytearray()

    def next_message(self, deadline: float) -> dict:
        while True:
            if len(self.buffer) >= 4:
                length = struct.unpack(">I", self.buffer[:4])[0]
                if length == 0 or length > MAX_FRAME:
                    raise AssertionError(f"invalid frame length: {length}")
                if len(self.buffer) >= length + 4:
                    payload = bytes(self.buffer[4 : length + 4])
                    del self.buffer[: length + 4]
                    message = json.loads(payload.decode("utf-8"))
                    assert isinstance(message, dict), "frame payload must be an object"
                    return message
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("timed out while reading frame")
            self.conn.settimeout(min(0.2, remaining))
            try:
                chunk = self.conn.recv(8192)
            except socket.timeout:
                continue
            if not chunk:
                raise ConnectionError("bridge EA closed the connection")
            self.buffer.extend(chunk)


def send_frame(conn: socket.socket, message: dict) -> None:
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    assert 0 < len(payload) <= MAX_FRAME, "capture frame exceeds protocol limit"
    conn.sendall(struct.pack(">I", len(payload)) + payload)


def envelope(message_type: str, message_id: str, session_id, payload: dict) -> dict:
    return {
        "v": 1,
        "type": message_type,
        "id": message_id,
        "session_id": session_id,
        "sent_at_ms": int(time.time() * 1000),
        "payload": payload,
    }


def expect_type(message: dict, expected: str) -> dict:
    assert message.get("v") == 1, f"expected protocol v1, got {message.get('v')!r}"
    assert message.get("type") == expected, f"first frame must be {expected}, got {message.get('type')!r}"
    payload = message.get("payload")
    assert isinstance(payload, dict), f"{expected} payload must be an object"
    return payload


def send_hello_ack(conn: socket.socket) -> None:
    send_frame(
        conn,
        envelope(
            "hello_ack",
            "rust-capture-hello-1",
            SESSION_ID,
            {
                "heartbeat_interval_ms": 2000,
                "heartbeat_timeout_ms": 6000,
                "trading_enabled": False,
                "transfer_limits": {"max_frame_bytes": MAX_FRAME, "max_ticks_per_page": 5000},
            },
        ),
    )


def send_reconcile_request(conn: socket.socket, request: dict) -> None:
    # Envelope id and payload request_id are the same correlation value.
    send_frame(conn, envelope("reconcile_request", REQUEST_ID, SESSION_ID, dict(request)))


def send_heartbeat_ack(conn: socket.socket, sequence) -> None:
    send_frame(
        conn,
        envelope("heartbeat_ack", f"rust-capture-heartbeat-{sequence}", SESSION_ID, {"sequence": sequence}),
    )


# --- validation helpers (mirror of trading-core protocol.rs) ----------------


def bounded_text(value, max_chars: int, allow_empty: bool = False) -> bool:
    """Mirror of protocol.rs bounded_text: non-empty (unless allowed), trimmed, bounded."""
    if not isinstance(value, str):
        return False
    if not allow_empty and value.strip() == "":
        return False
    if value.strip() != value:
        return False
    return len(value) <= max_chars


def decimal_shape_ok(value) -> bool:
    if not isinstance(value, str) or len(value) > 64:
        return False
    match = DECIMAL_RE.match(value)
    # match.end() guards against the '$'-before-trailing-newline quirk.
    return match is not None and match.end() == len(value)


def _has_nonzero_digit(value: str) -> bool:
    return any(char != "0" for char in value if char.isdigit())


def decimal_problem(value, kind: str):
    """Return a problem description for a decimal string of the given class, or None."""
    if kind == "optional-positive" and value is None:
        return None
    if not isinstance(value, str):
        return "is not a string"
    if not decimal_shape_ok(value):
        return "does not match ^-?[0-9]+(\\.[0-9]+)?$ over the whole string"
    if kind in ("positive", "nonnegative", "optional-positive") and value.startswith("-"):
        return "must not carry '-'"
    if kind == "positive" and not _has_nonzero_digit(value):
        return "must be > 0"
    return None


def comment_problem(value) -> str:
    if value is None:
        return None
    if not bounded_text(value, 256, allow_empty=True):
        return "must be null or trimmed <= 256 chars"
    return None


def _is_int(value) -> bool:
    return type(value) is int  # bool is not an int here


def _fmt_problems(problems, limit: int = 3) -> str:
    if len(problems) <= limit:
        return "; ".join(str(problem) for problem in problems)
    head = "; ".join(str(problem) for problem in problems[:limit])
    return f"{head} (+{len(problems) - limit} more)"


def _window(payload: dict, request: dict):
    """(history_from_ms, history_to_ms) used for record range checks; to may be None."""
    from_ms = payload.get("history_from_ms")
    if not _is_int(from_ms):
        from_ms = request["history_from_ms"]
    to_ms = payload.get("history_to_ms")
    if not _is_int(to_ms):
        to_ms = None
    return from_ms, to_ms


def _records(payload: dict, field: str):
    value = payload.get(field)
    return value if isinstance(value, list) else []


def _check_text(record: dict, index: int, label: str, field: str, max_chars: int, problems) -> None:
    if not bounded_text(record.get(field), max_chars, allow_empty=False):
        problems.append(f"{label}[{index}].{field} must be non-empty, trimmed, <= {max_chars} chars")


def _check_optional_id(record: dict, index: int, label: str, problems) -> None:
    value = record.get("position_id")
    if value is not None and not bounded_text(value, MAX_ID_CHARS, allow_empty=False):
        problems.append(f"{label}[{index}].position_id must be null or non-empty, trimmed, <= {MAX_ID_CHARS} chars")


def _check_unique_ids(records, field: str, label: str, problems) -> None:
    seen = set()
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            problems.append(f"{label}[{index}] is not an object")
            continue
        value = record.get(field)
        if not bounded_text(value, MAX_ID_CHARS, allow_empty=False):
            problems.append(f"{label}[{index}].{field} must be non-empty, trimmed, <= {MAX_ID_CHARS} chars")
        elif value in seen:
            problems.append(f"{label}[{index}].{field} duplicate {value!r}")
        else:
            seen.add(value)


def _check_decimals(records, label: str, fields, problems) -> None:
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            problems.append(f"{label}[{index}] is not an object")
            continue
        for field, kind in fields:
            problem = decimal_problem(record.get(field), kind)
            if problem is not None:
                problems.append(f"{label}[{index}].{field} {problem}")


def _check_comments(records, label: str, problems) -> None:
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            problems.append(f"{label}[{index}] is not an object")
            continue
        problem = comment_problem(record.get("comment"))
        if problem is not None:
            problems.append(f"{label}[{index}].comment {problem}")


RULE_ECHO = "echo: request_id/account_login/broker_server match the request"
RULE_SNAPSHOT_ID = "snapshot_id: non-empty, trimmed, <= 128 chars"
RULE_WINDOW = "history window: history_from_ms echoed; history_to_ms >= from; captured_at_ms >= to"
RULE_SEQUENCE = "sequence: sequence_after >= sequence_before; complete requires before == after"
RULE_COUNTS = "counts: positions/active_orders <= 500; history_orders/deals <= 500 (and <= 1000)"
RULE_IDS = "ids: non-empty, trimmed, <= 128 chars, unique within each collection"
RULE_ORDER_TIME = "history order timestamps: time_setup_ms >= 0; time_done_ms in [setup, window]"
RULE_ORDER_TEXT = "history order text: symbol/magic/order_type/state non-empty, trimmed, bounded"
RULE_ORDER_DECIMALS = "history order decimals: volumes/prices positive or non-negative; SL/TP null or positive"
RULE_ORDER_COMMENT = "history order comment: null or trimmed <= 256 chars"
RULE_DEAL_TIME = "history deal timestamps: time_ms within [history_from_ms, history_to_ms]"
RULE_DEAL_TEXT = "history deal text: symbol/magic/deal_type/entry non-empty, trimmed, bounded"
RULE_DEAL_DECIMALS = "history deal decimals: volume/price positive; profit/commission/swap/fee signed"
RULE_DEAL_COMMENT = "history deal comment: null or trimmed <= 256 chars"
RULE_DECIMAL_FORMAT = "decimal format: ^-?[0-9]+(\\.[0-9]+)?$; '-' only in signed fields"


def validate_snapshot(payload: dict, request: dict):
    """Return [(rule name, problems)] for a reconcile_snapshot payload."""
    rules = []

    # 1) identity echoes.
    problems = []
    for field in ("request_id", "account_login", "broker_server"):
        if payload.get(field) != request[field]:
            problems.append(f"{field} does not echo the request value")
    rules.append((RULE_ECHO, problems))

    # 2) snapshot_id bounds.
    problems = [] if bounded_text(payload.get("snapshot_id"), MAX_ID_CHARS) else [
        "snapshot_id must be non-empty, trimmed, <= 128 chars"
    ]
    rules.append((RULE_SNAPSHOT_ID, problems))

    # 3) history window.
    problems = []
    from_ms = payload.get("history_from_ms")
    to_ms = payload.get("history_to_ms")
    captured_at_ms = payload.get("captured_at_ms")
    if not _is_int(from_ms):
        problems.append("history_from_ms is not an integer")
    elif from_ms != request["history_from_ms"]:
        problems.append("history_from_ms does not equal the requested value")
    if not _is_int(to_ms):
        problems.append("history_to_ms is not an integer")
    elif _is_int(from_ms) and to_ms < from_ms:
        problems.append("history_to_ms < history_from_ms")
    if not _is_int(captured_at_ms):
        problems.append("captured_at_ms is not an integer")
    elif _is_int(to_ms) and captured_at_ms < to_ms:
        problems.append("captured_at_ms < history_to_ms")
    rules.append((RULE_WINDOW, problems))

    # 4) sequence discipline.
    problems = []
    before = payload.get("sequence_before")
    after = payload.get("sequence_after")
    complete = payload.get("complete")
    if not _is_int(before):
        problems.append("sequence_before is not an integer")
    if not _is_int(after):
        problems.append("sequence_after is not an integer")
    if _is_int(before) and _is_int(after) and after < before:
        problems.append("sequence_after < sequence_before")
    if not isinstance(complete, bool):
        problems.append("complete is not a boolean")
    elif complete and _is_int(before) and _is_int(after) and before != after:
        problems.append("complete=true requires sequence_before == sequence_after")
    rules.append((RULE_SEQUENCE, problems))

    # 5) collection counts.
    problems = []
    for field in ("positions", "active_orders", "history_orders", "history_deals"):
        value = payload.get(field)
        if not isinstance(value, list):
            problems.append(f"{field} is missing or not an array")
    positions = payload.get("positions")
    if isinstance(positions, list) and len(positions) > MAX_COLLECTION:
        problems.append(f"positions has {len(positions)} > {MAX_COLLECTION}")
    active_orders = payload.get("active_orders")
    if isinstance(active_orders, list) and len(active_orders) > MAX_COLLECTION:
        problems.append(f"active_orders has {len(active_orders)} > {MAX_COLLECTION}")
    for field in ("history_orders", "history_deals"):
        value = payload.get(field)
        if isinstance(value, list):
            if len(value) > request[f"max_{field}"]:
                problems.append(f"{field} has {len(value)} > max_{field}={request[f'max_{field}']}")
            if len(value) > MAX_HISTORY_LIMIT:
                problems.append(f"{field} has {len(value)} > {MAX_HISTORY_LIMIT}")
    rules.append((RULE_COUNTS, problems))

    # 6) identity fields and uniqueness within each collection.
    problems = []
    positions = _records(payload, "positions")
    _check_unique_ids(positions, "position_id", "positions", problems)
    active = _records(payload, "active_orders")
    _check_unique_ids(active, "order_id", "active_orders", problems)
    orders = _records(payload, "history_orders")
    _check_unique_ids(orders, "order_id", "history_orders", problems)
    for index, record in enumerate(orders):
        if isinstance(record, dict):
            _check_optional_id(record, index, "history_orders", problems)
    deals = _records(payload, "history_deals")
    _check_unique_ids(deals, "deal_id", "history_deals", problems)
    for index, record in enumerate(deals):
        if not isinstance(record, dict):
            continue  # already reported by _check_unique_ids
        if not bounded_text(record.get("order_id"), MAX_ID_CHARS, allow_empty=False):
            problems.append(f"history_deals[{index}].order_id must be non-empty, trimmed, <= {MAX_ID_CHARS} chars")
        _check_optional_id(record, index, "history_deals", problems)
    rules.append((RULE_IDS, problems))

    from_ms, to_ms = _window(payload, request)

    # 7) history order timestamps.
    problems = []
    if to_ms is None:
        problems.append("history_to_ms is not an integer; window range check impossible")
    for index, record in enumerate(orders):
        if not isinstance(record, dict):
            problems.append(f"history_orders[{index}] is not an object")
            continue
        setup = record.get("time_setup_ms")
        done = record.get("time_done_ms")
        if not _is_int(setup):
            problems.append(f"history_orders[{index}].time_setup_ms is not an integer")
        elif setup < 0:
            problems.append(f"history_orders[{index}].time_setup_ms < 0")
        if not _is_int(done):
            problems.append(f"history_orders[{index}].time_done_ms is not an integer")
            continue
        if _is_int(setup) and done < setup:
            problems.append(f"history_orders[{index}].time_done_ms < time_setup_ms")
        if to_ms is not None and (done < from_ms or done > to_ms):
            problems.append(f"history_orders[{index}].time_done_ms outside [history_from_ms, history_to_ms]")
    rules.append((RULE_ORDER_TIME, problems))

    # 8) history order text fields (bounds mirror protocol.rs: 128/128/64/64).
    problems = []
    for index, record in enumerate(orders):
        if not isinstance(record, dict):
            problems.append(f"history_orders[{index}] is not an object")
            continue
        _check_text(record, index, "history_orders", "symbol", 128, problems)
        _check_text(record, index, "history_orders", "magic", 128, problems)
        _check_text(record, index, "history_orders", "order_type", 64, problems)
        _check_text(record, index, "history_orders", "state", 64, problems)
    rules.append((RULE_ORDER_TEXT, problems))

    # 9) history order decimals.
    problems = []
    _check_decimals(orders, "history_orders", ORDER_DECIMAL_FIELDS, problems)
    rules.append((RULE_ORDER_DECIMALS, problems))

    # 10) history order comment.
    problems = []
    _check_comments(orders, "history_orders", problems)
    rules.append((RULE_ORDER_COMMENT, problems))

    # 11) history deal timestamps.
    problems = []
    if to_ms is None:
        problems.append("history_to_ms is not an integer; window range check impossible")
    for index, record in enumerate(deals):
        if not isinstance(record, dict):
            problems.append(f"history_deals[{index}] is not an object")
            continue
        when = record.get("time_ms")
        if not _is_int(when):
            problems.append(f"history_deals[{index}].time_ms is not an integer")
        elif to_ms is not None and (when < from_ms or when > to_ms):
            problems.append(f"history_deals[{index}].time_ms outside [history_from_ms, history_to_ms]")
    rules.append((RULE_DEAL_TIME, problems))

    # 12) history deal text fields (bounds mirror protocol.rs: 128/128/64/64).
    problems = []
    for index, record in enumerate(deals):
        if not isinstance(record, dict):
            problems.append(f"history_deals[{index}] is not an object")
            continue
        _check_text(record, index, "history_deals", "symbol", 128, problems)
        _check_text(record, index, "history_deals", "magic", 128, problems)
        _check_text(record, index, "history_deals", "deal_type", 64, problems)
        _check_text(record, index, "history_deals", "entry", 64, problems)
    rules.append((RULE_DEAL_TEXT, problems))

    # 13) history deal decimals.
    problems = []
    _check_decimals(deals, "history_deals", DEAL_DECIMAL_FIELDS, problems)
    rules.append((RULE_DEAL_DECIMALS, problems))

    # 14) history deal comment.
    problems = []
    _check_comments(deals, "history_deals", problems)
    rules.append((RULE_DEAL_COMMENT, problems))

    # 15) global decimal-string format (regex, no exponent/whitespace, sign placement).
    problems = []
    for label, records, fields in (
        ("history_orders", orders, ORDER_DECIMAL_FIELDS),
        ("history_deals", deals, DEAL_DECIMAL_FIELDS),
    ):
        known_fields = {field for field, _ in fields}
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                continue  # reported by the other rules
            for field in known_fields:
                value = record.get(field)
                if value is None:
                    continue  # nullable fields (SL/TP) may be null
                if not decimal_shape_ok(value):
                    problems.append(f"{label}[{index}].{field}={value!r} is not a plain decimal string")
                elif field not in SIGNED_DECIMAL_FIELDS and value.startswith("-"):
                    problems.append(f"{label}[{index}].{field}={value!r}: '-' only allowed in signed fields")
    rules.append((RULE_DECIMAL_FORMAT, problems))

    return rules


RULE_ERROR_ECHO = "echo: request_id matches the request"
RULE_ERROR_CODE = "code: non-empty, trimmed, <= 64 chars"
RULE_ERROR_MESSAGE = "message: non-empty, trimmed, <= 256 chars"


def validate_error(payload: dict, request: dict):
    """Return [(rule name, problems)] for a reconcile_error payload."""
    problems = []
    if payload.get("request_id") != request["request_id"]:
        problems.append("request_id does not echo the request value")
    echo_rule = (RULE_ERROR_ECHO, problems)

    problems = []
    if not bounded_text(payload.get("code"), 64, allow_empty=False):
        problems.append("code must be non-empty, trimmed, <= 64 chars")
    code_rule = (RULE_ERROR_CODE, problems)

    problems = []
    if not bounded_text(payload.get("message"), 256, allow_empty=False):
        problems.append("message must be non-empty, trimmed, <= 256 chars")
    message_rule = (RULE_ERROR_MESSAGE, problems)

    return [echo_rule, code_rule, message_rule]


def print_rules(rules) -> int:
    """Print one PASS/FAIL line per rule; return the number of failed rules."""
    failures = 0
    for name, problems in rules:
        if problems:
            failures += 1
            print(f"FAIL  {name}: {_fmt_problems(problems)}")
        else:
            print(f"PASS  {name}")
    return failures


def sample_counts(payload: dict, request: dict):
    """Observation counts for real-broker sample review (informational, no rules)."""
    orders = [record for record in _records(payload, "history_orders") if isinstance(record, dict)]
    deals = [record for record in _records(payload, "history_deals") if isinstance(record, dict)]
    from_ms = request["history_from_ms"]
    setup_before_window = sum(
        1 for record in orders if _is_int(record.get("time_setup_ms")) and record["time_setup_ms"] < from_ms
    )
    with_comments = 0
    for field in ("positions", "active_orders", "history_orders", "history_deals"):
        for record in _records(payload, field):
            if isinstance(record, dict) and record.get("comment") is not None:
                with_comments += 1
    deal_types = sorted({record["deal_type"] for record in deals if isinstance(record.get("deal_type"), str)})
    entries = sorted({record["entry"] for record in deals if isinstance(record.get("entry"), str)})
    return setup_before_window, with_comments, deal_types, entries


def print_sample_counts(payload: dict, request: dict) -> None:
    setup_before_window, with_comments, deal_types, entries = sample_counts(payload, request)
    print(f"INFO  history orders with time_setup_ms < history_from_ms: {setup_before_window}")
    print(f"INFO  records with comments: {with_comments}")
    print(f"INFO  distinct deal_type values: {deal_types}")
    print(f"INFO  distinct entry values: {entries}")


# --- capture flow ------------------------------------------------------------


def _await_response(reader: FrameReader, conn: socket.socket, deadline: float, counts: dict):
    """Heartbeat discipline + tolerance loop until the single reconcile response."""
    while True:
        try:
            message = reader.next_message(deadline)
        except TimeoutError as error:
            raise TimeoutError(
                f"no reconcile_snapshot/reconcile_error before MT5_CAPTURE_TIMEOUT_S ({error})"
            ) from None
        message_type = message.get("type")
        if message_type == "heartbeat":
            payload = message.get("payload")
            sequence = payload.get("sequence") if isinstance(payload, dict) else None
            send_heartbeat_ack(conn, sequence)
            counts["heartbeat"] = counts.get("heartbeat", 0) + 1
            continue
        if message_type in ("reconcile_snapshot", "reconcile_error"):
            payload = message.get("payload")
            if not isinstance(payload, dict):
                raise AssertionError(f"{message_type} payload must be an object")
            if message.get("session_id") != SESSION_ID:
                raise AssertionError(f"{message_type} session_id does not match {SESSION_ID!r}")
            if payload.get("request_id") != REQUEST_ID:
                raise AssertionError(
                    f"{message_type} payload request_id does not match {REQUEST_ID!r}"
                )
            counts[message_type] = counts.get(message_type, 0) + 1
            return message_type, payload
        key = message_type if isinstance(message_type, str) else repr(message_type)
        counts[key] = counts.get(key, 0) + 1
        print(f"capture: tolerated EA message: {key}", flush=True)


def _capture_session(conn: socket.socket, addr, deadline: float, out_path: str) -> int:
    reader = FrameReader(conn)
    print(f"capture: bridge EA connected from {addr[0]}:{addr[1]}", flush=True)
    counts: dict = {}

    # 1) first frame must be hello
    hello_message = reader.next_message(deadline)
    hello_payload = expect_type(hello_message, "hello")
    counts["hello"] = 1

    # 2) token handling -- never print the token value itself
    if "MT5_BRIDGE_TOKEN" in os.environ:
        expected = os.environ["MT5_BRIDGE_TOKEN"]
        if hello_payload.get("token") != expected:
            print("token: mismatch (token values are never printed)")
            raise AssertionError("hello token mismatch")
        print("token: match")
    else:
        print("token accepted unverified (dev capture)")

    identity = {}
    for field in ("account_login", "broker_server", "chart_symbol"):
        value = hello_payload.get(field)
        if not isinstance(value, str) or not value.strip():
            raise AssertionError(f"hello payload field {field!r} missing or empty")
        identity[field] = value
    print(
        "capture: hello identity: "
        f"account_login={identity['account_login']} "
        f"broker_server={identity['broker_server']} "
        f"chart_symbol={identity['chart_symbol']}",
        flush=True,
    )

    # 3) hello_ack
    send_hello_ack(conn)

    # 4) one reconcile_request, 7-day window, 500/500 history caps
    now_ms = int(time.time() * 1000)
    history_from_ms = max(0, now_ms - HISTORY_WINDOW_MS)
    request = {
        "request_id": REQUEST_ID,
        "account_login": identity["account_login"],
        "broker_server": identity["broker_server"],
        "history_from_ms": history_from_ms,
        "max_history_orders": MAX_COLLECTION,
        "max_history_deals": MAX_COLLECTION,
    }
    send_reconcile_request(conn, request)
    print(f"capture: reconcile_request {REQUEST_ID} sent (history_from_ms={history_from_ms})", flush=True)

    # 5) heartbeat_ack + tolerance loop until the single response
    message_type, payload = _await_response(reader, conn, deadline, counts)
    print(f"capture: received {message_type} (request_id={payload.get('request_id')!r})", flush=True)

    # 6) save raw payload + sidecar
    captured_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    meta_path = out_path + ".meta.json"
    meta = {
        "captured_at": captured_at,
        "hello": {
            "account_login": identity["account_login"],
            "broker_server": identity["broker_server"],
            "chart_symbol": identity["chart_symbol"],
        },
        "message_type": message_type,
        "observed_message_type_counts": dict(sorted(counts.items())),
    }
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"capture: saved raw payload to {out_path}", flush=True)
    print(f"capture: saved sidecar to {meta_path}", flush=True)
    print(f"capture: observed message-type counts: {dict(sorted(counts.items()))}", flush=True)

    # 7) contract validation
    print(f"--- contract validation ({message_type}) ---", flush=True)
    if message_type == "reconcile_snapshot":
        rules = validate_snapshot(payload, request)
    else:
        rules = validate_error(payload, request)
    failures = print_rules(rules)
    if message_type == "reconcile_snapshot":
        print_sample_counts(payload, request)
    total = len(rules)
    if failures:
        print(f"summary: FAIL - {failures}/{total} contract rules failed")
        return 1
    print(f"summary: PASS - {total}/{total} contract rules passed")
    return 0


def run_capture() -> int:
    host = os.environ.get("MT5_BRIDGE_HOST", DEFAULT_HOST)
    port = env_int("MT5_BRIDGE_PORT", DEFAULT_PORT)
    timeout_s = env_float("MT5_CAPTURE_TIMEOUT_S", DEFAULT_TIMEOUT_S)
    out_path = os.environ.get("MT5_CAPTURE_OUT", DEFAULT_OUT)
    if timeout_s <= 0:
        raise AssertionError("MT5_CAPTURE_TIMEOUT_S must be positive")
    deadline = time.monotonic() + timeout_s

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind((host, port))
        server.listen(1)
        print(
            f"capture: listening on {host}:{port} for the MetaTrader 5 bridge EA "
            f"(timeout {timeout_s:g}s, read-only)",
            flush=True,
        )
        remaining = deadline - time.monotonic()
        server.settimeout(max(0.1, remaining))
        try:
            conn, addr = server.accept()
        except socket.timeout:
            raise TimeoutError(f"no EA connection within {timeout_s:g}s") from None
        with conn:
            return _capture_session(conn, addr, deadline, out_path)
    finally:
        server.close()


# --- self-test ---------------------------------------------------------------


def _valid_snapshot(request: dict, now_ms: int) -> dict:
    from_ms = request["history_from_ms"]
    to_ms = now_ms
    time_done_ms = min(from_ms + 1000, to_ms)
    return {
        "request_id": request["request_id"],
        "account_login": request["account_login"],
        "broker_server": request["broker_server"],
        "snapshot_id": "capture-selftest-1",
        "history_from_ms": from_ms,
        "history_to_ms": to_ms,
        "sequence_before": 4,
        "sequence_after": 4,
        "complete": True,
        "captured_at_ms": to_ms,
        "positions": [{"position_id": "p-open-1"}],
        "active_orders": [{"order_id": "a-1"}],
        "history_orders": [
            {
                "order_id": "o-1",
                "position_id": "p-1",
                # setup deliberately before the window: exercises the
                # setup-before-window acceptance class and the INFO count.
                "time_setup_ms": from_ms - 5000,
                "time_done_ms": time_done_ms,
                "symbol": "NAS100",
                "magic": "42",
                "order_type": "buy",
                "state": "filled",
                "volume_initial": "0.10",
                "volume_current": "0.10",
                "price_open": "25000.1",
                "price_current": "25000.1",
                "stop_loss": None,
                "take_profit": None,
                "comment": None,
            }
        ],
        "history_deals": [
            {
                "deal_id": "d-1",
                "order_id": "o-1",
                "position_id": "p-1",
                "time_ms": time_done_ms,
                "symbol": "NAS100",
                "magic": "42",
                "deal_type": "buy",
                "entry": "in",
                "volume": "0.10",
                "price": "25000.1",
                "profit": "-1.25",
                "commission": "-0.20",
                "swap": "0",
                "fee": "0",
                "comment": "opened",
            }
        ],
    }


def _copy(value):
    return json.loads(json.dumps(value))


def _failing_names(rules):
    return [name for name, problems in rules if problems]


def run_selftest() -> int:
    total = 0
    failed = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal total
        total += 1
        if ok:
            print(f"self-test: {name} ... OK")
        else:
            suffix = f" -- {detail}" if detail else ""
            print(f"self-test: {name} ... FAIL{suffix}")
            failed.append(name)

    # --- loopback framing: EA side and capture side over a real TCP socket ---
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    host, port = server.getsockname()
    client = socket.create_connection((host, port), timeout=5)
    conn, _addr = server.accept()
    try:
        reader_server = FrameReader(conn)
        reader_client = FrameReader(client)
        soon = lambda: time.monotonic() + 5

        hello = envelope(
            "hello",
            "ea-selftest-1",
            None,
            {
                "token": "dev",
                "account_login": "12345678",
                "broker_server": "Selftest-Demo",
                "chart_symbol": "NAS100",
            },
        )
        send_frame(client, hello)
        got = reader_server.next_message(soon())
        check(
            "loopback: hello round-trip (4-byte BE length + JSON envelope)",
            got == hello,
            f"got {got!r}",
        )

        # fragmented frame: partial header, then the rest
        body = json.dumps(
            envelope("heartbeat", "ea-selftest-2", SESSION_ID, {"sequence": 7}),
            separators=(",", ":"),
        ).encode("utf-8")
        frame = struct.pack(">I", len(body)) + body
        client.sendall(frame[:6])
        time.sleep(0.05)
        client.sendall(frame[6:])
        got = reader_server.next_message(soon())
        check(
            "loopback: fragmented frame reassembled",
            got.get("type") == "heartbeat" and got.get("payload", {}).get("sequence") == 7,
            f"got {got!r}",
        )

        send_hello_ack(conn)
        got = reader_client.next_message(soon())
        payload = got.get("payload", {})
        check(
            "loopback: hello_ack envelope shape",
            got.get("v") == 1
            and got.get("type") == "hello_ack"
            and got.get("session_id") == SESSION_ID
            and payload.get("heartbeat_interval_ms") == 2000
            and payload.get("heartbeat_timeout_ms") == 6000
            and payload.get("trading_enabled") is False,
            f"got {got!r}",
        )

        request = {
            "request_id": REQUEST_ID,
            "account_login": "12345678",
            "broker_server": "Selftest-Demo",
            "history_from_ms": 1700000000000,
            "max_history_orders": MAX_COLLECTION,
            "max_history_deals": MAX_COLLECTION,
        }
        send_reconcile_request(conn, request)
        got = reader_client.next_message(soon())
        payload = got.get("payload", {})
        check(
            "loopback: reconcile_request id/payload/echo shape",
            got.get("type") == "reconcile_request"
            and got.get("id") == REQUEST_ID
            and payload.get("request_id") == REQUEST_ID
            and payload.get("account_login") == "12345678"
            and payload.get("history_from_ms") == 1700000000000
            and payload.get("max_history_orders") == MAX_COLLECTION
            and payload.get("max_history_deals") == MAX_COLLECTION,
            f"got {got!r}",
        )

        send_frame(
            client,
            envelope("heartbeat", "ea-selftest-3", SESSION_ID, {"sequence": 9}),
        )
        got = reader_server.next_message(soon())
        send_heartbeat_ack(conn, got.get("payload", {}).get("sequence"))
        got = reader_client.next_message(soon())
        check(
            "loopback: heartbeat_ack echoes sequence",
            got.get("type") == "heartbeat_ack"
            and got.get("session_id") == SESSION_ID
            and got.get("payload", {}).get("sequence") == 9,
            f"got {got!r}",
        )
    finally:
        conn.close()
        client.close()
        server.close()

    # bad framing headers, each on a fresh pair so buffers stay clean
    for name, header in (
        ("framing: zero-length frame rejected", struct.pack(">I", 0)),
        ("framing: oversize frame header rejected", struct.pack(">I", MAX_FRAME + 1)),
    ):
        left, right = socket.socketpair()
        try:
            right.sendall(header)
            try:
                FrameReader(left).next_message(time.monotonic() + 2)
                rejected = False
            except AssertionError:
                rejected = True
            check(name, rejected)
        finally:
            left.close()
            right.close()

    # --- validator: positive case + informational counts ---
    now_ms = int(time.time() * 1000)
    request = {
        "request_id": REQUEST_ID,
        "account_login": "12345678",
        "broker_server": "Selftest-Demo",
        "history_from_ms": max(0, now_ms - HISTORY_WINDOW_MS),
        "max_history_orders": MAX_COLLECTION,
        "max_history_deals": MAX_COLLECTION,
    }
    snapshot = _valid_snapshot(request, now_ms)
    rules = validate_snapshot(snapshot, request)
    check(
        "validator: valid snapshot passes every rule",
        not _failing_names(rules),
        f"failing: {_failing_names(rules)}",
    )
    setup_before, comments, deal_types, entries = sample_counts(snapshot, request)
    check(
        "validator: INFO counts correct (setup-before-window / comments / deal types)",
        setup_before == 1 and comments == 1 and deal_types == ["buy"] and entries == ["in"],
        f"got setup_before={setup_before}, comments={comments}, deal_types={deal_types}, entries={entries}",
    )

    # --- validator: negative cases, each must fail its target rule ---
    def negative(name: str, mutate, target_rule: str) -> None:
        payload = _copy(snapshot)
        mutate(payload)
        rules = validate_snapshot(payload, request)
        failing = _failing_names(rules)
        check(
            f"validator rejects: {name}",
            target_rule in failing,
            f"expected {target_rule!r}, failing={failing}",
        )

    def set_field(payload, field, value):
        payload[field] = value

    negative(
        "request_id echo mismatch",
        lambda p: set_field(p, "request_id", "someone-else"),
        RULE_ECHO,
    )
    negative(
        "padded snapshot_id",
        lambda p: set_field(p, "snapshot_id", " padded "),
        RULE_SNAPSHOT_ID,
    )
    negative(
        "history_from_ms not echoed",
        lambda p: set_field(p, "history_from_ms", p["history_from_ms"] + 1),
        RULE_WINDOW,
    )
    negative(
        "sequence regression",
        lambda p: (set_field(p, "sequence_before", 5), set_field(p, "sequence_after", 4)),
        RULE_SEQUENCE,
    )
    negative(
        "complete=true with changed sequence",
        lambda p: set_field(p, "sequence_after", p["sequence_before"] + 1),
        RULE_SEQUENCE,
    )
    negative(
        "duplicate history order id",
        lambda p: p["history_orders"].append(_copy(p["history_orders"][0])),
        RULE_IDS,
    )
    negative(
        "duplicate active order id",
        lambda p: p["active_orders"].append(_copy(p["active_orders"][0])),
        RULE_IDS,
    )
    negative(
        "time_done_ms after window",
        lambda p: p["history_orders"][0].__setitem__("time_done_ms", p["history_to_ms"] + 1),
        RULE_ORDER_TIME,
    )
    negative(
        "negative volume_initial",
        lambda p: p["history_orders"][0].__setitem__("volume_initial", "-0.10"),
        RULE_ORDER_DECIMALS,
    )
    negative(
        "exponent price_open",
        lambda p: p["history_orders"][0].__setitem__("price_open", "1e3"),
        RULE_ORDER_DECIMALS,
    )
    negative(
        "overlong order comment",
        lambda p: p["history_orders"][0].__setitem__("comment", "x" * 257),
        RULE_ORDER_COMMENT,
    )
    negative(
        "too many history orders (>500)",
        lambda p: p.__setitem__(
            "history_orders", [_copy(p["history_orders"][0]) for _ in range(MAX_COLLECTION + 1)]
        ),
        RULE_COUNTS,
    )
    negative(
        "deal time before window",
        lambda p: p["history_deals"][0].__setitem__("time_ms", p["history_from_ms"] - 1),
        RULE_DEAL_TIME,
    )
    negative(
        "comma-decimal profit",
        lambda p: p["history_deals"][0].__setitem__("profit", "12,50"),
        RULE_DEAL_DECIMALS,
    )
    negative(
        "negative deal price",
        lambda p: p["history_deals"][0].__setitem__("price", "-10"),
        RULE_DEAL_DECIMALS,
    )

    # --- reconcile_error validation, positive and negative ---
    error_payload = {
        "request_id": REQUEST_ID,
        "code": "ACCOUNT_UNAVAILABLE",
        "message": "MT5 account is not connected",
    }
    rules = validate_error(error_payload, request)
    check(
        "validator: valid reconcile_error passes every rule",
        not _failing_names(rules),
        f"failing: {_failing_names(rules)}",
    )
    rules = validate_error(
        {"request_id": "wrong", "code": "C" * 65, "message": "M" * 257}, request
    )
    failing = _failing_names(rules)
    check(
        "validator rejects: reconcile_error with wrong request_id / long code / long message",
        failing == [RULE_ERROR_ECHO, RULE_ERROR_CODE, RULE_ERROR_MESSAGE],
        f"failing={failing}",
    )

    if failed:
        print(f"self-test: FAILED - {len(failed)} of {total} checks failed: {failed}")
        return 1
    print(f"self-test: PASSED - {total} checks (framing loopback + validator positive/negative)")
    return 0


def main(argv) -> int:
    if any(arg in ("-h", "--help") for arg in argv):
        print(USAGE)
        return 0
    if argv:
        print(USAGE)
        return 2
    selftest_env = os.environ.get("MT5_CAPTURE_SELFTEST")
    if selftest_env is not None and selftest_env.strip() not in ("", "0"):
        print("running in-process loopback self-test (no files are written)")
        return run_selftest()
    return run_capture()


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (AssertionError, ConnectionError, TimeoutError, OSError) as error:
        print(f"capture FAILED: {error}")
        raise SystemExit(1)
