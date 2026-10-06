#!/usr/bin/env python3
"""End-to-end client mock that drives the Rust bridge server as an EA."""

import json
import os
from pathlib import Path
import socket
import struct
import time

BRIDGE_CONFIG = json.loads((Path(__file__).resolve().parent.parent / "config/bridge.json").read_text())
TIMEFRAMES = json.loads((Path(__file__).resolve().parent.parent / "config/timeframes.json").read_text())
SUPPORTED_TIMEFRAMES = [entry["code"] for entry in TIMEFRAMES["timeframes"]]

LEGACY_TRANSFER_LIMITS = {"max_frame_bytes": 1024 * 1024, "max_ticks_per_page": 5000}
TRANSFER_LIMITS = {"max_frame_bytes": 8 * 1024 * 1024, "max_ticks_per_page": 65535}
MAX_FRAME = TRANSFER_LIMITS["max_frame_bytes"]
TIMEOUT_SECONDS = 20.0
HEARTBEAT_SECONDS = 2.0
RECONCILE_STATE = {"seen": False, "request": None, "outcome": None}
RECONCILE_COUNTER = {"snapshot": 0}


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


class FrameReader:
    def __init__(self, conn: socket.socket) -> None:
        self.conn = conn
        self.buffer = bytearray()
        self.transfer_limits = dict(LEGACY_TRANSFER_LIMITS)

    def next_message(self, deadline: float) -> dict:
        while True:
            if len(self.buffer) >= 4:
                length = struct.unpack(">I", self.buffer[:4])[0]
                if length == 0 or length > self.transfer_limits["max_frame_bytes"]:
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
                raise ConnectionError("Rust server closed the connection")
            self.buffer.extend(chunk)


def send_frame(conn: socket.socket, message: dict, max_frame: int = MAX_FRAME) -> None:
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    assert 0 < len(payload) <= max_frame, "mock frame exceeds protocol limit"
    conn.sendall(struct.pack(">I", len(payload)) + payload)


def envelope(message_type: str, message_id: str, session_id: str | None, payload: dict) -> dict:
    return {"v": 1, "type": message_type, "id": message_id, "session_id": session_id, "sent_at_ms": int(time.time() * 1000), "payload": payload}


def synthetic_tick_history(request: dict, session_id: str, limits: dict) -> dict:
    """Generate an oldest prefix, bounded by both count and serialized bytes."""
    maximum = request["max_ticks"]
    assert 1 <= maximum <= limits["max_ticks_per_page"]
    start, end = request["from_ms"], request["to_ms"]
    assert 0 <= start < end
    payload = {
        "request_id": request["_request_id"], "symbol": request["symbol"],
        "from_ms": start, "to_ms": end, "tick_size": "0.1", "complete": False, "ticks": [],
    }
    message = envelope("tick_history_snapshot", "ea-ticks", session_id, payload)
    used = len(json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode())
    first = ((start + 9) // 10) * 10
    available = max(0, (end - first + 9) // 10)
    for index in range(min(maximum, available)):
        tick = {"time_ms": first + index * 10, "bid": "100.0", "ask": "100.1", "last": "0.0", "volume": 0, "volume_real": "0.00000000", "flags": 6}
        size = len(json.dumps(tick, separators=(",", ":")).encode()) + (1 if payload["ticks"] else 0)
        if used + size > limits["max_frame_bytes"]:
            break
        payload["ticks"].append(tick)
        used += size
    assert payload["ticks"] or available == 0, "tick record exceeds negotiated frame budget"
    payload["complete"] = len(payload["ticks"]) == available
    return message


def handle_tick_history(reader: FrameReader, conn: socket.socket, session_id: str | None, message: dict) -> bool:
    if message.get("type") != "tick_history_request":
        return False
    assert session_id is not None and message.get("session_id") == session_id
    request = {**message["payload"], "_request_id": message["id"]}
    response = synthetic_tick_history(request, session_id, reader.transfer_limits)
    if request.get("price_counts", False):
        response = tick_price_summary(response)
    send_frame(conn, response, reader.transfer_limits["max_frame_bytes"])
    return True


def tick_price_summary(message: dict) -> dict:
    """Exact summary of the accepted prefix of this synthetic raw page."""
    raw = message["payload"]
    ticks = raw["ticks"]
    through = raw["to_ms"] if raw["complete"] else (ticks[-1]["time_ms"] if ticks else raw["from_ms"])
    accepted = [tick for tick in ticks if tick["time_ms"] < through]
    if not accepted and not raw["complete"]:
        through = raw["from_ms"]
    count = len(accepted)
    payload = {key: value for key, value in raw.items() if key != "ticks"}
    payload.update({"through_ms": through, "loaded_ticks": count, "rejected_ticks": 0,
        "min_quote": "100.0" if count else None, "max_quote": "100.1" if count else None,
        "prices": [{"price": "100.0", "total": count, "bid": count, "ask": 0, "bid_seen": True},
                   {"price": "100.1", "total": 0, "bid": 0, "ask": count, "bid_seen": False}] if count else []})
    return {**message, "type": "tick_price_history_snapshot", "payload": payload}


# Oldest bar time the mock's synthetic history reaches. A page that cannot be
# filled reports complete=False, which is how a client learns it reached the end.
HISTORY_FLOOR_MS = 1_699_992_800_000
HISTORY_INTERVAL_MS = 60_000


def synthetic_history_page(request: dict, session_id: str, max_frame: int) -> dict:
    """One page of candles strictly older than the client's `before_ms` anchor."""
    before_ms = request.get("before_ms")
    assert isinstance(before_ms, int) and before_ms > 0, request
    bars = request.get("bars")
    assert isinstance(bars, int) and 1 <= bars <= 1000, request
    candles = []
    time_ms = before_ms - HISTORY_INTERVAL_MS
    while len(candles) < bars and time_ms >= HISTORY_FLOOR_MS:
        candles.append({"time_ms": time_ms, "open": "99.0", "high": "100.0", "low": "98.0", "close": "99.5",
                        "tick_volume": 5, "spread": 2, "real_volume": 0})
        time_ms -= HISTORY_INTERVAL_MS
    candles.reverse()
    message = envelope("history_snapshot", "ea-history-page", session_id, {
        "request_id": request["_request_id"], "symbol": request["symbol"], "timeframe": request["timeframe"],
        "complete": len(candles) == bars, "before_ms": before_ms, "candles": candles,
    })
    assert len(json.dumps(message, separators=(",", ":")).encode()) <= max_frame
    return message


def handle_history_page(reader: FrameReader, conn: socket.socket, session_id: str | None, message: dict) -> bool:
    """Answers an older-history page. A page is identified by its anchor rather
    than by its message type, so this is tested before the window branch."""
    if message.get("type") != "history_request":
        return False
    payload = message.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get("before_ms"), int):
        return False
    assert session_id is not None and message.get("session_id") == session_id
    request = {**payload, "_request_id": message.get("id")}
    send_frame(conn, synthetic_history_page(request, session_id, reader.transfer_limits["max_frame_bytes"]),
               reader.transfer_limits["max_frame_bytes"])
    return True


def self_test_history_page() -> int:
    request = {"symbol": "TEST.INIT", "timeframe": "M1", "bars": 1000, "before_ms": 1_700_000_000_000,
               "_request_id": "synthetic-history-page"}
    payload = synthetic_history_page(request, "synthetic-session", TRANSFER_LIMITS["max_frame_bytes"])["payload"]
    # The mock's history is shorter than a page, so the client is told it is done.
    assert payload["complete"] is False
    assert payload["before_ms"] == request["before_ms"]
    assert payload["candles"]
    times = [candle["time_ms"] for candle in payload["candles"]]
    assert times == sorted(times) and len(set(times)) == len(times)
    assert times[-1] < request["before_ms"], "a page must be strictly older than its anchor"
    assert times[0] == HISTORY_FLOOR_MS
    # A page that exactly fits the remaining history reports complete=True.
    small = synthetic_history_page({**request, "bars": len(times)}, "synthetic-session",
                                   TRANSFER_LIMITS["max_frame_bytes"])["payload"]
    assert small["complete"] is True and len(small["candles"]) == len(times)
    print("mock older-history page self-test passed: strictly-older pages, ordered candles, end of history reported")
    return 0


def self_test_tick_history() -> int:
    for limits in (TRANSFER_LIMITS, LEGACY_TRANSFER_LIMITS, {**TRANSFER_LIMITS, "max_frame_bytes": 1024 * 1024}):
        request = {"symbol": "TEST.SYNTHETIC", "from_ms": 1_700_000_000_000, "to_ms": 1_700_001_000_000, "max_ticks": limits["max_ticks_per_page"], "_request_id": "synthetic-page"}
        message = synthetic_tick_history(request, "synthetic-session", limits)
        payload = message["payload"]
        size = len(json.dumps(message, separators=(",", ":")).encode())
        assert size <= limits["max_frame_bytes"]
        assert 0 < len(payload["ticks"]) <= request["max_ticks"]
        assert payload["complete"] is False
        assert payload["ticks"][0]["time_ms"] == request["from_ms"]
        if limits == TRANSFER_LIMITS:
            assert size > LEGACY_TRANSFER_LIMITS["max_frame_bytes"]
            assert len(payload["ticks"]) == request["max_ticks"]
        summary = tick_price_summary(message)["payload"]
        assert summary["loaded_ticks"] == len(payload["ticks"]) - 1
        assert summary["through_ms"] == payload["ticks"][-1]["time_ms"]
        assert sum(price["total"] for price in summary["prices"]) == summary["loaded_ticks"]
        assert len(json.dumps(summary).encode()) < 1024
        if limits["max_frame_bytes"] == 1024 * 1024 and request["max_ticks"] == 65535:
            assert len(payload["ticks"]) < request["max_ticks"]
    request = {"symbol": "TEST.SYNTHETIC", "from_ms": 101, "to_ms": 111, "max_ticks": 5000, "_request_id": "boundary-page"}
    payload = synthetic_tick_history(request, "synthetic-session", LEGACY_TRANSFER_LIMITS)["payload"]
    assert payload["complete"] is True and [tick["time_ms"] for tick in payload["ticks"]] == [110]
    assert tick_price_summary(synthetic_tick_history(request, "synthetic-session", LEGACY_TRANSFER_LIMITS))["payload"]["loaded_ticks"] == 1
    print("mock tick-history self-test passed: large pages, legacy limits, byte budgets and half-open ranges")
    return 0


def expect_type(message: dict, expected: str) -> dict:
    assert message.get("v") == 1, f"expected protocol v1, got {message.get('v')!r}"
    assert message.get("type") == expected, f"expected {expected}, got {message.get('type')!r}"
    payload = message.get("payload")
    assert isinstance(payload, dict), f"{expected} payload must be an object"
    return payload


def market_session_fragment(symbol: str = "TEST.INIT") -> dict:
    """EA market-session observation carried on every heartbeat.

    The mock is always inside an open session: Rust's submission gate compares
    `symbol` against the order symbol and requires `is_open` to be true.
    """
    return {"symbol": symbol, "is_open": True, "trade_mode": 4, "server_time_ms": 1700000120000}


def maybe_heartbeat(conn: socket.socket, session_id: str, heartbeat_state: dict) -> None:
    now = time.monotonic()
    if now >= heartbeat_state["next"]:
        heartbeat_state["sequence"] += 1
        sequence = heartbeat_state["sequence"]
        send_frame(conn, envelope("heartbeat", f"ea-heartbeat-{sequence}", session_id, {
            "sequence": sequence, "terminal_connected": True, "account_connected": True,
            "broker_server": "mock", "market_session": market_session_fragment(),
        }))
        heartbeat_state["next"] = now + HEARTBEAT_SECONDS


def wait_for(reader: FrameReader, conn: socket.socket, expected_type: str, session_id: str, deadline: float, heartbeat_state: dict) -> dict:
    while True:
        maybe_heartbeat(conn, session_id, heartbeat_state)
        try:
            message = reader.next_message(min(deadline, time.monotonic() + 0.2))
        except TimeoutError:
            continue
        message_type = message.get("type")
        if message_type == "heartbeat_ack":
            assert message.get("session_id") == session_id
            continue
        assert message.get("session_id") == session_id, message
        if handle_reconcile(reader, conn, session_id, message):
            continue
        if handle_tick_history(reader, conn, session_id, message):
            continue
        if handle_history_page(reader, conn, session_id, message):
            continue
        if message_type == expected_type:
            payload = message.get("payload", {})
            assert isinstance(payload, dict), f"{expected_type} payload must be an object"
            return {**payload, "_request_id": message.get("id")}
        if message_type == "error":
            raise AssertionError(f"Rust server returned protocol error: {message}")
        raise AssertionError(f"expected {expected_type}, got {message_type!r}")


def next_non_reconcile(reader: FrameReader, conn: socket.socket, session_id: str | None, deadline: float) -> dict:
    while True:
        message = reader.next_message(deadline)
        if handle_reconcile(reader, conn, session_id, message):
            continue
        if handle_tick_history(reader, conn, session_id, message):
            continue
        if handle_history_page(reader, conn, session_id, message):
            continue
        return message


def symbol_info(symbol: str, description: str) -> dict:
    return {
        "symbol": symbol, "description": description, "digits": 1,
        "tick_size": "0.1", "point_size": "0.1", "contract_size": "1",
        "volume_min": "0.01", "volume_max": "100.00", "volume_step": "0.01", "trade_mode": 0,
        "stops_level": 0, "freeze_level": 0, "filling_mode": 1, "order_mode": 127,
        "expiration_mode": 15, "trade_execution": 2,
    }


def reply_symbol_info(conn: socket.socket, session_id: str, request: dict) -> None:
    symbol = request.get("symbol")
    assert isinstance(symbol, str) and symbol
    send_frame(conn, envelope("symbol_info_result", "ea-symbol-info", session_id, {
        "request_id": request.get("_request_id"), "symbol_info": symbol_info(symbol, f"{symbol} integration test"),
    }))


def reply_risk_quote(conn: socket.socket, session_id: str, request: dict) -> None:
    send_frame(conn, envelope("risk_quote_result", "ea-risk-quote", session_id, {
        "draft_id": request["draft_id"], "symbol": request["symbol"], "side": request["side"],
        "entry": request["entry"], "stop_loss": request["stop_loss"], "take_profit": request.get("take_profit"),
        "reference_volume": "1.00", "loss_at_reference": "10.00", "reward_at_reference": "20.00",
        "margin_at_reference": "100.00", "currency": "USD", "tick_size": "0.1",
        "volume_min": "0.01", "volume_max": "100.00", "volume_step": "0.01", "quoted_at_ms": 1700000122000,
    }))


def reply_order_check(conn: socket.socket, session_id: str, request: dict) -> None:
    # Echo the entire draft verbatim; this mock is read-only and never sends orders.
    assert request["order_kind"] in {"market", "limit", "stop", "stop_limit"}, request["order_kind"]
    time_in_force = request.get("time_in_force")
    assert time_in_force in (None, "gtc", "day", "ioc", "fok"), time_in_force
    limit_price = request.get("limit_price")
    if request["order_kind"] == "stop_limit":
        assert isinstance(limit_price, str) and limit_price, "stop_limit requires limit_price"
    # One-line positive-decimal sanity for the echoed field (echo stays read-only).
    assert limit_price is None or (isinstance(limit_price, str) and limit_price.replace(".", "", 1).isdigit() and float(limit_price) > 0), "limit_price must be a positive decimal"
    send_frame(conn, envelope("order_check_result", "ea-order-check", session_id, {
        "draft_id": request["draft_id"], "account_login": request["account_login"],
        "broker_server": request["broker_server"], "symbol": request["symbol"],
        "side": request["side"], "order_kind": request["order_kind"], "volume": request["volume"],
        "requested_entry": request["entry"], "check_price": request["entry"],
        "stop_loss": request.get("stop_loss"), "take_profit": request.get("take_profit"),
        "check_passed": True, "retcode": 0, "last_error": 0, "balance": "10000.00",
        "equity": "10000.00", "profit": "0.00", "margin": "100.00",
        "free_margin": "9900.00", "margin_level": "10000.00", "comment": "Mock preflight accepted",
        "checked_at_ms": 1700000123000,
        "time_in_force": time_in_force, "limit_price": limit_price,
    }))


def reply_reconcile(conn: socket.socket, session_id: str | None, request: dict, envelope_id) -> str:
    outcome = os.environ.get("MT5_MOCK_RECONCILE_OUTCOME", "snapshot").lower()
    assert outcome in {"snapshot", "incomplete", "incomplete-flat", "error"}, (
        "MT5_MOCK_RECONCILE_OUTCOME must be snapshot, incomplete, incomplete-flat or error "
        "(incomplete = complete=false with sequence_after = sequence_before + 1; "
        "incomplete-flat = complete=false with sequence_after == sequence_before, i.e. truncation/caps)"
    )
    request_id = request.get("request_id") or envelope_id
    if outcome == "error":
        send_frame(conn, envelope("reconcile_error", "ea-reconcile-error", session_id, {
            "request_id": request_id, "code": "HISTORY_SELECT_FAILED",
            "message": "mock reconciliation failure",
        }))
        return outcome
    RECONCILE_COUNTER["snapshot"] += 1
    snapshot_number = RECONCILE_COUNTER["snapshot"]
    history_from_ms = int(request.get("history_from_ms", 0))
    now_ms = int(time.time() * 1000)
    history_to_ms = max(now_ms, history_from_ms)
    captured_at_ms = max(now_ms, history_to_ms)
    # Setup may precede the requested window (setup-before-window acceptance rule);
    # done stays inside [history_from_ms, history_to_ms] and never before setup.
    time_setup_ms = history_from_ms - 5000
    time_done_ms = min(history_from_ms + 1000, history_to_ms)
    time_done_ms = max(time_done_ms, time_setup_ms)
    sequence_before = snapshot_number
    sequence_after = snapshot_number + 1 if outcome == "incomplete" else snapshot_number
    send_frame(conn, envelope("reconcile_snapshot", f"ea-reconcile-{snapshot_number}", session_id, {
        "request_id": request_id, "account_login": request.get("account_login"),
        "broker_server": request.get("broker_server"), "snapshot_id": f"mock-snapshot-{snapshot_number}",
        "history_from_ms": history_from_ms, "history_to_ms": history_to_ms,
        "sequence_before": sequence_before, "sequence_after": sequence_after,
        "complete": outcome == "snapshot", "captured_at_ms": captured_at_ms,
        "positions": [], "active_orders": [],
        "history_orders": [{
            "order_id": f"mock-order-{snapshot_number}", "position_id": f"mock-position-{snapshot_number}",
            "time_setup_ms": time_setup_ms, "time_done_ms": time_done_ms,
            "symbol": "TEST.INIT", "magic": "42", "order_type": "buy", "state": "filled",
            "volume_initial": "0.10", "volume_current": "0.10",
            "price_open": "100.5", "price_current": "100.5",
            "stop_loss": None, "take_profit": None, "comment": None,
        }],
        "history_deals": [{
            "deal_id": f"mock-deal-{snapshot_number}", "order_id": f"mock-order-{snapshot_number}",
            "position_id": f"mock-position-{snapshot_number}", "time_ms": time_done_ms,
            "symbol": "TEST.INIT", "magic": "42", "deal_type": "buy", "entry": "in",
            "volume": "0.10", "price": "100.5",
            "profit": "0", "commission": "-0.20", "swap": "0", "fee": "0", "comment": None,
        }],
    }))
    return outcome


def handle_reconcile(reader: FrameReader, conn: socket.socket, session_id: str | None, message: dict) -> bool:
    if message.get("type") != "reconcile_request":
        return False
    request = message.get("payload")
    assert isinstance(request, dict), "reconcile_request payload must be an object"
    outcome = reply_reconcile(conn, session_id or message.get("session_id"), request, message.get("id"))
    RECONCILE_STATE.update({"seen": True, "request": request, "outcome": outcome})
    return True


def main() -> int:
    host = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
    port = env_int("MT5_BRIDGE_PORT", 8877)
    token = os.environ.get("MT5_BRIDGE_TOKEN", "integration-token")
    mode = os.environ.get("MT5_MOCK_MODE", "search").lower()
    assert mode in {"search", "smoke", "ordercheck", "reconcile"}, "MT5_MOCK_MODE must be search, smoke, ordercheck or reconcile"
    deadline = time.monotonic() + TIMEOUT_SECONDS

    with socket.create_connection((host, port), timeout=max(0.1, deadline - time.monotonic())) as conn:
        reader = FrameReader(conn)
        send_frame(conn, envelope("hello", "ea-test-1", None, {
            "token": token, "terminal_id": "mock-terminal", "terminal_build": 5000,
            "account_login": "12345678", "broker_server": "mock", "chart_symbol": "TEST.INIT",
            "expert_version": BRIDGE_CONFIG["expertAdviserVersion"], "trading_enabled": False,
            "supported_timeframes": SUPPORTED_TIMEFRAMES,
            "transfer_limits": TRANSFER_LIMITS,
            "tick_price_counts": True,
        }))
        hello_ack = next_non_reconcile(reader, conn, None, deadline)
        hello_payload = expect_type(hello_ack, "hello_ack")
        session_id = hello_ack.get("session_id")
        assert isinstance(session_id, str) and session_id
        # The mock's hello disables execution; the ACK reports the server's
        # local dispatch setting, which may be enabled independently.
        assert isinstance(hello_payload.get("trading_enabled"), bool)
        reader.transfer_limits = hello_payload.get("transfer_limits", dict(LEGACY_TRANSFER_LIMITS))
        assert 1024 <= reader.transfer_limits["max_frame_bytes"] <= TRANSFER_LIMITS["max_frame_bytes"]
        assert 1 <= reader.transfer_limits["max_ticks_per_page"] <= TRANSFER_LIMITS["max_ticks_per_page"]
        heartbeat_state = {"sequence": 0, "next": time.monotonic() + HEARTBEAT_SECONDS}

        initial_request = next_non_reconcile(reader, conn, session_id, deadline)
        initial = expect_type(initial_request, "history_request")
        assert initial_request.get("session_id") == session_id
        assert initial.get("symbol") == "TEST.INIT" and initial.get("timeframe") == "M1"
        send_frame(conn, envelope("history_snapshot", "ea-history-init", session_id, {
            "request_id": initial_request.get("id"), "symbol": "TEST.INIT", "timeframe": "M1", "complete": True,
            "candles": [
                {"time_ms": 1700000000000, "open": "100.0", "high": "101.0", "low": "99.0", "close": "100.5", "tick_volume": 10, "spread": 2, "real_volume": 0},
                {"time_ms": 1700000060000, "open": "100.5", "high": "102.0", "low": "100.0", "close": "101.5", "tick_volume": 12, "spread": 2, "real_volume": 0},
                {"time_ms": 1700000120000, "open": "101.5", "high": "103.0", "low": "101.0", "close": "102.5", "tick_volume": 14, "spread": 2, "real_volume": 0},
            ],
        }))
        print("initial history snapshot sent", flush=True)

        initial_symbol_info = wait_for(reader, conn, "symbol_info_request", session_id, deadline, heartbeat_state)
        reply_symbol_info(conn, session_id, initial_symbol_info)

        if mode == "reconcile":
            while not RECONCILE_STATE["seen"]:
                assert time.monotonic() < deadline, "timed out waiting for reconcile_request"
                maybe_heartbeat(conn, session_id, heartbeat_state)
                try:
                    message = reader.next_message(min(deadline, time.monotonic() + 0.2))
                except TimeoutError:
                    continue
                if handle_reconcile(reader, conn, session_id, message):
                    continue
                if handle_tick_history(reader, conn, session_id, message):
                    continue
                message_type = message.get("type")
                if message_type == "heartbeat_ack":
                    continue
                assert message.get("session_id") == session_id, message
                if message_type == "symbol_info_request":
                    info_request = message.get("payload")
                    assert isinstance(info_request, dict), "symbol_info_request payload must be an object"
                    reply_symbol_info(conn, session_id, {**info_request, "_request_id": message.get("id")})
                elif message_type == "history_request":
                    history_payload = message.get("payload")
                    assert isinstance(history_payload, dict), "history_request payload must be an object"
                    send_frame(conn, envelope("history_snapshot", "ea-history-reconcile", session_id, {
                        "request_id": message.get("id"), "symbol": history_payload.get("symbol"),
                        "timeframe": history_payload.get("timeframe"), "complete": True,
                        "candles": [
                            {"time_ms": 1700000000000, "open": "100.0", "high": "101.0", "low": "99.0", "close": "100.5", "tick_volume": 10, "spread": 2, "real_volume": 0},
                            {"time_ms": 1700000060000, "open": "100.5", "high": "102.0", "low": "100.0", "close": "101.5", "tick_volume": 12, "spread": 2, "real_volume": 0},
                            {"time_ms": 1700000120000, "open": "101.5", "high": "103.0", "low": "101.0", "close": "102.5", "tick_volume": 14, "spread": 2, "real_volume": 0},
                        ],
                    }))
                else:
                    raise AssertionError(f"unexpected {message_type!r} in reconcile mode")
            print(f"reconcile request received: {json.dumps(RECONCILE_STATE['request'], sort_keys=True)}", flush=True)
            outcome = RECONCILE_STATE["outcome"]
            outcome_note = (
                " (complete=false, sequence_after == sequence_before: truncation/caps variant)"
                if outcome == "incomplete-flat"
                else ""
            )
            print(f"reconcile outcome: {outcome}{outcome_note}", flush=True)
            return 0

        if mode in {"smoke", "ordercheck"}:
            send_frame(conn, envelope("account_snapshot", "ea-account-1", session_id, {
                "account_login": "12345678", "broker_server": "mock", "currency": "USD",
                "balance": "10000.00", "equity": "10000.00", "margin": "0.00",
                "free_margin": "10000.00", "margin_level": "0.0000", "leverage": 100,
                "margin_mode": 2, "trade_allowed": False, "expert_allowed": False,
                "account_trade_mode": 0, "account_trade_mode_name": "demo",
            }))
            send_frame(conn, envelope("portfolio_snapshot", "ea-portfolio-1", session_id, {
                "account_login": "12345678", "captured_at_ms": 1700000121000,
                "positions": [{
                    "position_id": "9001", "ticket": "9001", "symbol": "TEST.INIT", "side": "buy",
                    "volume": "0.10", "price_open": "100.0", "price_current": "102.5",
                    "stop_loss": "98.0", "take_profit": None, "profit": "25.00", "swap": "-0.10",
                    "time_ms": 1700000000000, "magic": "42",
                }],
                "orders": [{
                    "order_id": "7001", "symbol": "US100.TEST", "order_type": "buy_limit", "state": "placed",
                    "volume_initial": "0.10", "volume_current": "0.10", "price_open": "18000.0",
                    "price_current": "18000.0", "stop_loss": None, "take_profit": "18100.0",
                    "time_setup_ms": 1700000120000, "expiration_ms": 1700003720000, "magic": "42",
                }],
            }))
            send_frame(conn, envelope("quote_update", "ea-quote-1", session_id, {
                "symbol": "TEST.INIT", "time_ms": 1700000120000, "bid": "102.4", "ask": "102.6",
                "last": "102.5", "volume": 14, "volume_real": "0", "flags": 6,
            }))
            send_frame(conn, envelope("heartbeat", "ea-heartbeat-1", session_id, {
                "sequence": 1, "terminal_connected": True, "account_connected": True,
                "broker_server": "mock", "market_session": market_session_fragment(),
            }))
            heartbeat_ack = next_non_reconcile(reader, conn, session_id, deadline)
            heartbeat_payload = expect_type(heartbeat_ack, "heartbeat_ack")
            assert heartbeat_ack.get("session_id") == session_id
            assert heartbeat_payload.get("sequence") == 1
            if mode == "smoke":
                print("account snapshot, quote update and heartbeat smoke checks passed", flush=True)
                return 0
            risk_request = wait_for(reader, conn, "risk_quote_request", session_id, deadline, heartbeat_state)
            assert all(isinstance(risk_request.get(key), str) for key in ("draft_id", "symbol", "side", "entry", "stop_loss"))
            reply_risk_quote(conn, session_id, risk_request)
            print("mock risk quote sent", flush=True)
            order_request = wait_for(reader, conn, "order_check_request", session_id, deadline, heartbeat_state)
            assert order_request.get("account_login") == "12345678"
            assert order_request.get("broker_server") == "mock"
            assert order_request.get("symbol") == "TEST.INIT"
            reply_order_check(conn, session_id, order_request)
            print("read-only mock OrderCheck result sent; no order was executed", flush=True)
            return 0

        search_request = wait_for(reader, conn, "symbol_search_request", session_id, deadline, heartbeat_state)
        query = search_request.get("query")
        assert isinstance(query, str) and 1 <= search_request.get("limit", 0) <= 50
        send_frame(conn, envelope("symbol_search_result", "ea-search-1", session_id, {
            "request_id": search_request.get("_request_id"), "query": query,
            "symbols": [symbol_info("US100.TEST", "US 100 integration test")],
        }))
        print("symbol search result sent", flush=True)

        history_request = wait_for(reader, conn, "history_request", session_id, deadline, heartbeat_state)
        assert history_request.get("symbol") == "US100.TEST"
        timeframe = history_request.get("timeframe")
        assert timeframe in SUPPORTED_TIMEFRAMES
        send_frame(conn, envelope("history_snapshot", "ea-history-us100", session_id, {
            "request_id": history_request.get("_request_id"), "symbol": "US100.TEST", "timeframe": timeframe, "complete": True,
            "candles": [
                {"time_ms": 1700000000000, "open": "18000.0", "high": "18001.0", "low": "17999.0", "close": "18000.5", "tick_volume": 10, "spread": 2, "real_volume": 0},
                {"time_ms": 1700000060000, "open": "18000.5", "high": "18002.0", "low": "18000.0", "close": "18001.5", "tick_volume": 12, "spread": 2, "real_volume": 0},
                {"time_ms": 1700000120000, "open": "18001.5", "high": "18003.0", "low": "18001.0", "close": "18002.5", "tick_volume": 14, "spread": 2, "real_volume": 0},
            ],
        }))
        selected_symbol_info = wait_for(reader, conn, "symbol_info_request", session_id, deadline, heartbeat_state)
        reply_symbol_info(conn, session_id, selected_symbol_info)
        print("US100.TEST history snapshot sent; integration checks passed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(
            self_test_history_page() + self_test_tick_history()
            if os.environ.get("MT5_MOCK_SELFTEST") == "1"
            else main()
        )
    except (AssertionError, ConnectionError, TimeoutError, OSError) as error:
        print(f"mock bridge FAILED: {error}")
        raise SystemExit(1)
