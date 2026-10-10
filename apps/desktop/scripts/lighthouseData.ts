import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import timeframeConfig from '../../../config/timeframes.json' with { type: 'json' };
import type { BrokerSymbol, Candle } from '../src/shared/bridge/types';
import { brokerSymbolFixture, type RecordedHistory } from '../e2e/helpers/tauriStub';

/**
 * Loader for MetaTrader 5 "Symbols -> Bars -> Export" CSV files, used by the
 * Lighthouse harness to replay real candles through the Tauri stub.
 *
 * File name: `<SYMBOL>_<TIMEFRAME>.csv` (`EURUSD_M5.csv`). Format: header row
 * with `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>`
 * (tab or comma separated; `<TIME>` is absent in daily+ exports), dates as
 * `2026.10.09`, times as `13:05:00` (server time, treated as UTC). UTF-8 and
 * UTF-16LE (with BOM) are accepted. OHLC stay the exact decimal strings.
 */

const TIMEFRAMES = new Set(timeframeConfig.timeframes.map((entry) => entry.code));
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  return buffer.toString('utf8');
}

function fail(file: string, line: number, message: string): never {
  throw new Error(`${file}:${line}: ${message}`);
}

function decimalOrFail(file: string, line: number, name: string, value: string | undefined): string {
  if (value === undefined || !DECIMAL.test(value) || !Number.isFinite(Number(value))) {
    return fail(file, line, `${name} is not a finite decimal: ${JSON.stringify(value)}`);
  }
  return value;
}

function intOrFail(file: string, line: number, name: string, value: string | undefined): number {
  if (value === undefined || value === '') {
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fail(file, line, `${name} is not a non-negative number: ${JSON.stringify(value)}`);
  }
  return Math.round(n);
}

function parseTimeMs(file: string, line: number, date: string, time: string | undefined): number {
  const d = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time ?? '00:00:00');
  if (!d || !t) {
    return fail(file, line, `bad date/time: ${JSON.stringify(`${date} ${time ?? ''}`)}`);
  }
  const ms = Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!, +(t[3] ?? 0));
  if (!Number.isFinite(ms)) {
    return fail(file, line, `unrepresentable date/time: ${date} ${time ?? ''}`);
  }
  return ms;
}

/** Parses one export; `file` is only used in error locations. */
export function parseMt5Csv(text: string, file: string): Candle[] {
  const lines = text.split(/\r?\n/);
  let headerAt = lines.findIndex((l) => l.trim() !== '');
  if (headerAt < 0) {
    return fail(file, 1, 'file is empty');
  }
  const delimiter = lines[headerAt]!.includes('\t') ? '\t' : ',';
  const cols = new Map(
    lines[headerAt]!.split(delimiter).map((name, index) => [name.trim().replace(/[<>]/g, '').toUpperCase(), index]),
  );
  for (const required of ['DATE', 'OPEN', 'HIGH', 'LOW', 'CLOSE']) {
    if (!cols.has(required)) {
      return fail(file, headerAt + 1, `header is missing <${required}> (got ${lines[headerAt]!.trim()})`);
    }
  }
  headerAt += 1;
  const candles: Candle[] = [];
  for (let i = headerAt; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw.trim() === '') {
      continue;
    }
    const line = i + 1;
    const cells = raw.split(delimiter).map((c) => c.trim());
    const cell = (name: string) => {
      const index = cols.get(name);
      return index === undefined ? undefined : cells[index];
    };
    const open = decimalOrFail(file, line, 'OPEN', cell('OPEN'));
    const high = decimalOrFail(file, line, 'HIGH', cell('HIGH'));
    const low = decimalOrFail(file, line, 'LOW', cell('LOW'));
    const close = decimalOrFail(file, line, 'CLOSE', cell('CLOSE'));
    if (Number(high) < Number(low)) {
      fail(file, line, `high ${high} < low ${low}`);
    }
    const timeMs = parseTimeMs(file, line, cell('DATE') ?? '', cell('TIME'));
    const prev = candles.at(-1);
    if (prev && timeMs === prev.timeMs) {
      fail(file, line, `duplicate time ${new Date(timeMs).toISOString()}`);
    }
    if (prev && timeMs < prev.timeMs) {
      fail(file, line, `not ascending: ${new Date(timeMs).toISOString()} after ${new Date(prev.timeMs).toISOString()}`);
    }
    candles.push({
      timeMs,
      open,
      high,
      low,
      close,
      tickVolume: intOrFail(file, line, 'TICKVOL', cell('TICKVOL')),
      spread: intOrFail(file, line, 'SPREAD', cell('SPREAD')),
      realVolume: intOrFail(file, line, 'VOL', cell('VOL')),
    });
  }
  if (candles.length === 0) {
    fail(file, headerAt, 'no data rows');
  }
  return candles;
}

function decimalsOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

/** Price digits as the largest fraction length seen, which is what MT5 prints. */
function symbolInfoFor(symbol: string, candles: Candle[]): BrokerSymbol {
  let digits = 0;
  for (const c of candles) {
    digits = Math.max(digits, decimalsOf(c.open), decimalsOf(c.high), decimalsOf(c.low), decimalsOf(c.close));
  }
  const point = digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`;
  return brokerSymbolFixture(symbol, `${symbol} (recorded)`, {
    digits,
    tickSize: point,
    pointSize: point,
    tradeMode: 4,
  });
}

export interface LoadedRecordings {
  /** Primary first (LIGHTHOUSE_SYMBOL / LIGHTHOUSE_TIMEFRAME, else first file). */
  history: RecordedHistory[];
  files: string[];
}

/** Default cap on bars handed to the page: 1000 initial + older pages the audit may scroll. */
export const DEFAULT_MAX_BARS = 20_000;
/** Generous upper bound of bytes per CSV row (real rows are ~55). */
const BYTES_PER_ROW = 100;

/**
 * Reads the header plus the last `maxBars` rows of a large UTF-8/ASCII export
 * without loading the whole file; smaller files and UTF-16 are read whole.
 * Returns CSV text (header + tail rows) whose first row is a complete line.
 */
function readTail(file: string, maxBars: number): string {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(size, 4096));
    readSync(fd, head, 0, head.length, 0);
    const tailBytes = maxBars * BYTES_PER_ROW;
    const isUtf16 = head[0] === 0xff && head[1] === 0xfe;
    if (isUtf16 || size <= head.length + tailBytes) {
      return decodeText(readFileSync(file));
    }
    const headerText = decodeText(head);
    const header = headerText.slice(0, headerText.search(/\r?\n/));
    const tail = Buffer.alloc(tailBytes);
    readSync(fd, tail, 0, tailBytes, size - tailBytes);
    const text = tail.toString('utf8');
    // The first line is almost always cut mid-row; drop it.
    return `${header}\n${text.slice(text.indexOf('\n') + 1)}`;
  } finally {
    closeSync(fd);
  }
}

/** Loads every `<SYMBOL>_<TIMEFRAME>.csv` in `dir`; empty when there are none. */
export function loadRecordings(
  dir: string,
  wantSymbol?: string,
  wantTimeframe?: string,
  maxBars: number = DEFAULT_MAX_BARS,
): LoadedRecordings {
  if (!existsSync(dir)) {
    return { history: [], files: [] };
  }
  const names = readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.csv'))
    .sort();
  const history: RecordedHistory[] = [];
  for (const name of names) {
    const match = /^(.+)_([A-Za-z0-9]+)\.csv$/i.exec(name);
    const symbol = match?.[1];
    const timeframe = match?.[2]?.toUpperCase();
    if (!symbol || !timeframe || !TIMEFRAMES.has(timeframe)) {
      throw new Error(
        `${join(dir, name)}: expected <SYMBOL>_<TIMEFRAME>.csv with a supported timeframe (e.g. EURUSD_M5.csv)`,
      );
    }
    const file = join(dir, name);
    const candles = parseMt5Csv(readTail(file, maxBars), file).slice(-maxBars);
    history.push({ symbol, timeframe, candles, symbolInfo: symbolInfoFor(symbol, candles) });
  }
  const matches = (h: RecordedHistory) =>
    (!wantSymbol || h.symbol === wantSymbol) && (!wantTimeframe || h.timeframe === wantTimeframe.toUpperCase());
  // The app opens the config default timeframe (M1): prefer it when not told otherwise.
  const primaryAt = history.findIndex((h) => matches(h) && (wantTimeframe || h.timeframe === timeframeConfig.default));
  if (primaryAt < 0 && history.some(matches)) {
    history.unshift(history.splice(history.findIndex(matches), 1)[0]!);
    return { history, files: names };
  }
  if (history.length > 0 && primaryAt < 0) {
    throw new Error(
      `No file in ${dir} matches LIGHTHOUSE_SYMBOL=${wantSymbol ?? '*'} LIGHTHOUSE_TIMEFRAME=${wantTimeframe ?? '*'}`,
    );
  }
  if (primaryAt > 0) {
    history.unshift(history.splice(primaryAt, 1)[0]!);
  }
  return { history, files: names };
}
