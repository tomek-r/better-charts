import type { MarketDataPort } from '../../src/features/bridge/marketDataPort';
import type { ChartToolHost } from '../../src/features/chart/engine/tools/toolContract';

/** The symbol every fake host reports. */
export const FAKE_SYMBOL = 'DEMO.TEST';
/** Pane x of one bar slot: a click at `slot * SLOT_WIDTH_PX` lands on that bar. */
export const SLOT_WIDTH_PX = 10;

const FIRST_BAR_SECONDS = 1_000;
const BAR_SECONDS = 60;
const BAR_COUNT = 10;
const PANE_WIDTH = 600;
const PANE_HEIGHT = 400;

/** The bar series a fake host starts with: specs may replace `bars`, `timeframe` and `intervalSeconds`. */
export interface FakeBarSeries {
  bars: Array<{ time: number }>;
  timeframe: string;
  intervalSeconds: number;
}

/** A chart host for Node-run specs: fixed geometry, a recording market, and the two drawing callbacks. */
export interface FakeToolHost {
  host: ChartToolHost;
  barSeries: FakeBarSeries;
  /** The ids the tool reported through `drawingPlaced`, in order. */
  placedIds: string[];
  /** The messages the tool surfaced through `notifyError`, in order. */
  errors: string[];
  /** How many times the tool reported a user edit through `drawingsChanged`. */
  changeCount(): number;
  repaintCount(): number;
  /** The quote time the tool sees; undefined means no quote has arrived. */
  setQuoteTime(timeMs: number | undefined): void;
}

/** Ten one-minute bars from 1_000 s: the series every fake host starts with. */
export function oneMinuteBars(): Array<{ time: number }> {
  return Array.from({ length: BAR_COUNT }, (_, index) => ({ time: FIRST_BAR_SECONDS + index * BAR_SECONDS }));
}

export function createFakeToolHost(marketDataPort: MarketDataPort): FakeToolHost {
  const barSeries: FakeBarSeries = { bars: oneMinuteBars(), timeframe: 'M1', intervalSeconds: BAR_SECONDS };
  const placedIds: string[] = [];
  const errors: string[] = [];
  let changes = 0;
  let repaints = 0;
  let quoteTimeMs: number | undefined;
  const host = {
    barSeries,
    geometry: {
      viewport: () => ({ chartRect: { x: 0, y: 0, width: PANE_WIDTH, height: PANE_HEIGHT } }),
      slotAt: (x: number) => Math.floor(x / SLOT_WIDTH_PX),
      timeToX: (timeMs: number) => ((timeMs / 1000 - FIRST_BAR_SECONDS) / BAR_SECONDS) * SLOT_WIDTH_PX,
      priceToY: () => Number.NaN,
      yToPrice: () => Number.NaN,
    },
    currentMarket: {
      symbol: () => FAKE_SYMBOL,
      quote: () => (quoteTimeMs === undefined ? undefined : { symbol: FAKE_SYMBOL, timeMs: quoteTimeMs }),
    },
    marketDataPort,
    requestRepaint: () => {
      repaints += 1;
    },
    returnToDefaultTool: () => undefined,
    notifyError: (message: string) => {
      errors.push(message);
    },
    drawingShownOnTimeframe: () => true,
    drawingPlaced: (drawingId: string) => {
      placedIds.push(drawingId);
    },
    drawingsChanged: () => {
      changes += 1;
    },
  } as unknown as ChartToolHost;
  return {
    host,
    barSeries,
    placedIds,
    errors,
    changeCount: () => changes,
    repaintCount: () => repaints,
    setQuoteTime: (timeMs) => {
      quoteTimeMs = timeMs;
    },
  };
}
