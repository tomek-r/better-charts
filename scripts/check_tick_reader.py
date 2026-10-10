"""Source guards for the MT5 bridge and dependent-indicator tick reader.

These checks guard tick loading and trading permissions; they complement MetaEditor
compilation and the native demo probe, and do not start MT5 or place orders.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
READER = (ROOT / "mql5/bridge/Indicators/BetterChartsTickHistoryReader.mq5").read_text(encoding="utf-8")
EA = (ROOT / "mql5/bridge/Experts/BetterChartsBridge.mq5").read_text(encoding="utf-8")


class TickReaderSourceGuards(unittest.TestCase):
    def test_trading_permission_is_shared_by_handshake_log_and_dispatch(self):
        helper = EA.split("bool TradingEnabled()", 1)[1].split("bool SendHello()", 1)[0]
        for flag in ("TERMINAL_CONNECTED", "TERMINAL_TRADE_ALLOWED", "MQL_TRADE_ALLOWED",
                     "ACCOUNT_LOGIN", "ACCOUNT_TRADE_ALLOWED", "ACCOUNT_TRADE_EXPERT"):
            self.assertIn(flag, helper)
        self.assertIn('TradingEnabled() ? "true" : "false"', EA)
        self.assertIn('TradingEnabled() ? "yes" : "no"', EA)
        self.assertEqual(EA.count("if(!TradingEnabled())"), 2)
        self.assertNotIn("trading_enabled=yes", EA)
        self.assertNotIn(r'\"trading_enabled\":true', EA)

    def test_rebranding_preserves_execution_journal_path(self):
        self.assertIn('#define BRIDGE_COMMAND_JOURNAL        "TradeCanvasBridge.commands.log"', EA)

    def test_ea_loads_the_renamed_tick_reader(self):
        self.assertRegex(EA, r'\biCustom\([^;]*"BetterChartsTickHistoryReader"')

    def test_reader_and_ea_agree_on_the_versioned_page_header(self):
        for source in (READER, EA):
            self.assertIn("#define BRIDGE_READER_MAGIC         0x54435032", source)
            self.assertIn("#define BRIDGE_READER_VERSION_BYTES 16", source)
        self.assertIn("#define BRIDGE_READER_HEADER_BYTES  28", EA)
        self.assertIn("#property version BRIDGE_TICK_READER_VERSION", READER)
        self.assertNotIn("0x54435031,INT_VALUE", READER)
        # magic + 16 version bytes + error + count
        self.assertEqual(4 + 16 + 4 + 4, 28)
        # The EA rejects the unversioned layout instead of misparsing it.
        self.assertIn("BRIDGE_READER_MAGIC_LEGACY", EA)

    def test_version_probe_is_bounded_and_never_sleeps(self):
        probe = EA.split("bool RunReaderProbe()", 1)[1].split("bool QueueTickHistory(", 1)[0]
        self.assertIn("BRIDGE_READER_PROBE_TIMEOUT_MS", probe)
        self.assertNotIn("Sleep(", EA)
        self.assertIn("if(!RunReaderProbe()) return;", EA.split("void TryConnect()", 1)[1])
        self.assertRegex(EA, r"#define BRIDGE_READER_PROBE_TIMEOUT_MS 3000\b")
        # The probe handle and file are always released when it settles.
        finish = EA.split("void FinishReaderProbe(", 1)[1].split("bool RunReaderProbe()", 1)[0]
        self.assertIn("ReleaseReaderProbe();", finish)
        self.assertIn("tick_reader_version", EA)

    def test_dependent_indicator_reads_during_initialization(self):
        init = READER.split("int OnInit()", 1)[1].split("void ReadTickPage()", 1)[0]
        self.assertIn("ReadTickPage();", init)
        self.assertNotRegex(READER, r"\bvoid\s+OnTimer\s*\(")
        self.assertNotIn("EventSetMillisecondTimer", READER)

    def test_ea_never_calls_the_blocking_tick_api(self):
        self.assertIsNone(re.search(r"\bCopyTicks(?:Range)?\s*\(", EA))
        self.assertIn("StartTickReaderAttempt();", EA)
        self.assertIn("g_tick_attempt_ms>=250", EA)

    def test_tick_page_uses_a_byte_buffer(self):
        page = EA.split("void PollTickHistory()", 1)[1].split("bool SameBar", 1)[0]
        self.assertIn("SendPayloadBytes(g_tick_payload,g_tick_payload_size)", page)
        self.assertIn("ArrayCopy(g_tick_payload,entry_bytes", page)
        self.assertNotIn("g_tick_body", page)

    def test_price_counts_are_exact_and_keep_timestamp_boundary(self):
        prepare = EA.split("bool PreparePriceTickPayload()", 1)[1].split("bool AddPriceCount", 1)[0]
        self.assertIn("time_msc>=g_tick_through", prepare)
        aggregate = EA.split("void PollPriceTickPayload()", 1)[1].split("bool PrepareRawTickPayload", 1)[0]
        self.assertIn("valid && (bid_changed || ask_changed)", aggregate)
        self.assertIn("g_tick_rejected++", aggregate)
        self.assertIn("GetTickCount64()-started>=5", aggregate)
        self.assertIn("PrepareRawTickPayload();", aggregate)
        self.assertNotIn("TickJson(", aggregate)

    def test_tick_buffer_growth_is_geometric_and_bounded(self):
        grow = EA.split("bool GrowTickPayload", 1)[1].split("bool AppendPricePayload", 1)[0]
        self.assertIn("(long)current*2", grow)
        self.assertIn("g_max_frame_bytes", grow)
        self.assertIn("required", grow)
        price = EA.split("bool AppendPricePayload", 1)[1].split("void PollPriceTickPayload", 1)[0]
        raw = EA.split("void PollTickHistory()", 1)[1].split("bool SameBar", 1)[0]
        self.assertIn("GrowTickPayload(g_tick_payload_size+size)", price)
        self.assertIn("GrowTickPayload(required)", raw)
        # Doubling requires at most log2(max/first)+1 allocations and copies
        # less than twice the final capacity even for one-byte appends.
        maximum = 8 * 1024 * 1024
        capacity = 0
        copied = 0
        allocations = 0
        for required in range(1, maximum + 1):
            if required <= capacity:
                continue
            copied += capacity
            capacity = min(maximum, max(required, max(65536, capacity * 2)))
            allocations += 1
        self.assertEqual(allocations, 8)
        self.assertLess(copied, maximum)


if __name__ == "__main__":
    unittest.main()
