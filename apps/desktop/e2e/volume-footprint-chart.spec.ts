import { expect, test, type Page } from '@playwright/test';
import { FOOTPRINT_BAR_SPACING } from '../src/features/chart/engine/barStyle/volumeFootprint/footprintZoom';
import { FOOTPRINT_NEUTRAL_COLOR } from '../src/features/chart/engine/barStyle/volumeFootprint/footprintShades';
import type { ChartFootprintEvent, ChartFootprintRow, Candle } from '../src/shared/bridge/types';
import { palette } from '../src/shared/theme/palette';
import { waitTwoAnimationFrames } from './helpers/animationFrames';
import { openChartSettingsTab } from './helpers/chartSettingsDialog';
import { chooseOption } from './helpers/select';
import { DEFAULT_FOOTPRINT_SETTINGS } from './helpers/footprintFixtures';
import { openChart } from './helpers/openChart';
import {
  decodePng,
  horizontalRunsPainting,
  parseHexColor,
  sitesPainting,
  sitesTintedToward,
  type DecodedPng,
  type PixelChannels,
  type PixelRegion,
  type PixelSite,
} from './helpers/pngPixels';
import {
  chartScopeKey,
  expectNoErrors,
  gotoWithStub,
  STUB_M5_INTERVAL_MS,
  STUB_NOW,
  stubInvocations,
  type RecordedHistory,
} from './helpers/tauriStub';

/**
 * The volume footprint bar style on a live chart: the host's chart footprint follows the style, the bars'
 * footprints reach the custom series, a bar the host holds none for keeps drawing as a plain candle, and
 * the totals, delta box, imbalance marks and legend notice are painted. The Symbol tab edits what the cells
 * write, and a setting the host computes rows with reaches it at once.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');
/** What the style asks the host for while it draws, which is the appearance's own defaults. */
const DEFAULT_FOOTPRINT_REQUEST = {
  rowSize: { kind: 'auto', atrLength: 14 },
  vaPercent: 70,
  imbalancePercent: 300,
};
/** The opening time of the newest bar of the stub's default window, which the fixture footprint belongs to. */
const NEWEST_BAR_OPEN_MS = STUB_NOW - STUB_M5_INTERVAL_MS;
/** The row width the fixture's host resolved, in the symbol's ticks. */
const TICKS_PER_ROW = 20;
/** The prices the fixture's rows span, lowest first: a band inside the newest bar of the window. */
const ROW_PRICES = [1.0844, 1.0848, 1.0852];
/** The volume every fixture row traded, so all of a side's cells take the same shade. */
const ROW_VOLUME = 480;
/** The trades behind each side of a fixture row's volume, one trade per ten lots. */
const ROW_TRADES = 48;
/** The lightest shade of each side, which cells of equal volume are drawn in. */
const SELL_LIGHTEST = parseHexColor('#ff99a0');
const BUY_LIGHTEST = parseHexColor('#5cc4b4');
/** The neutral shade a cell with no side to shade is drawn in, which a balanced delta of the fixture takes. */
const NEUTRAL_CELL = parseHexColor(FOOTPRINT_NEUTRAL_COLOR);
/** The body colour the anchor's default candles rise in. */
const UP_CANDLE = parseHexColor('#26a69a');
/** A cell paints far wider than this; a sloping line's anti-aliased edge is 1-2 px. */
const MIN_CELL_RUN = 6;
/** The colour of each side's total under its own column, and of the delta of a bar that traded both alike. */
const SELL_TOTAL = parseHexColor('#F23645');
const BUY_TOTAL = parseHexColor('#089981');
const DELTA_NEUTRAL = parseHexColor('#c4c9d0');
/** The colour of the imbalance mark each side's cells are marked with. */
const SELL_IMBALANCE = parseHexColor('#F23645');
const BUY_IMBALANCE = parseHexColor('#089981');
/**
 * The pane background the bars and the summary under them are painted on, which a glyph's edges blend into:
 * the chart's default solid background, palette.overlay.
 */
const PANE_BACKGROUND = parseHexColor(palette.overlay);
/** The outline of the box the delta and the total sit in: a palette token no cell or axis draws. */
const SUMMARY_BOX_BORDER = parseHexColor(palette.borderStrong);
/** An imbalance mark is three css px wide, which the suite's one-to-one pixel ratio keeps in device pixels. */
const IMBALANCE_MARK_RUN = 3;
/** The box spans a bar's columns, so its outline paints a run far longer than a glyph's stroke. */
const MIN_SUMMARY_BOX_RUN = 20;
/** The share a stacked zone's 20 % wash is read at, allowing for the pane's own background and a rounded channel. */
const MIN_ZONE_FILL_SHARE = 0.15;
/** A zone's top and bottom edges paint the full colour, so their runs reach far past an imbalance mark's. */
const MIN_ZONE_EDGE_RUN = 20;
/** How far past its rows a zone's top and bottom edges paint, in css px, which the suite's pixel ratio keeps. */
const ZONE_EDGE_MARGIN = 2;
/** The month and weekday names the chart's default time labels write. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The rows of the fixture footprint, one per consecutive pair of prices, as decimal strings the host sends. */
function fixtureRows(): ChartFootprintRow[] {
  const rows: ChartFootprintRow[] = [];
  for (let index = 0; index < ROW_PRICES.length - 1; index += 1) {
    rows.push({
      row: index,
      downPrice: ROW_PRICES[index].toFixed(4),
      upPrice: ROW_PRICES[index + 1].toFixed(4),
      buyVolume: ROW_VOLUME.toFixed(2),
      sellVolume: ROW_VOLUME.toFixed(2),
      buyTrades: ROW_TRADES,
      sellTrades: ROW_TRADES,
      buyImbalance: false,
      sellImbalance: false,
    });
  }
  return rows;
}

/** The window the host publishes: one footprint, for the newest bar of the stub's window. */
const FOOTPRINT_EVENT: ChartFootprintEvent = {
  symbol: 'EURUSD',
  timeframe: 'M5',
  ticksPerRow: TICKS_PER_ROW,
  bars: [
    {
      openMs: NEWEST_BAR_OPEN_MS,
      rows: fixtureRows(),
      buyVolume: (ROW_VOLUME * (ROW_PRICES.length - 1)).toFixed(2),
      sellVolume: (ROW_VOLUME * (ROW_PRICES.length - 1)).toFixed(2),
      buyTrades: ROW_TRADES * (ROW_PRICES.length - 1),
      sellTrades: ROW_TRADES * (ROW_PRICES.length - 1),
      poc: 1,
      vah: 1,
      val: 0,
      volume: 'real',
    },
  ],
  incompleteBefore: null,
  incomplete: [],
};

/** The footprint of the newest bar with each side of one row imbalanced, and the other one balanced. */
function imbalancedFootprintEvent(): ChartFootprintEvent {
  const rows = fixtureRows();
  rows[0] = { ...rows[0], sellImbalance: true };
  rows[1] = { ...rows[1], buyImbalance: true };
  return { ...FOOTPRINT_EVENT, bars: [{ ...FOOTPRINT_EVENT.bars[0], rows }] };
}

/** The footprint of the newest bar whose volumes count trades, read only part way into its oldest bar. */
function incompleteFootprintEvent(): ChartFootprintEvent {
  return {
    ...FOOTPRINT_EVENT,
    bars: [{ ...FOOTPRINT_EVENT.bars[0], volume: 'ticks' }],
    incompleteBefore: NEWEST_BAR_OPEN_MS,
    incomplete: [NEWEST_BAR_OPEN_MS],
  };
}

/** The M5 window the stacked-zone fixture draws, and the place in it of the bar the footprint belongs to. */
const ZONE_WINDOW_BARS = 10;
const ZONE_BAR_INDEX = 6;
/** The high the fixture bar reached, which holds the zone's prices, and the high every other bar stayed under. */
const ZONE_BAR_HIGH = '1.0860';
const LATER_BAR_HIGH = '1.0835';

/** The opening time of the `index`-th bar of the stacked-zone window, its newest bar opening one interval ago. */
function zoneWindowOpenMs(index: number): number {
  return STUB_NOW - (ZONE_WINDOW_BARS - index) * STUB_M5_INTERVAL_MS;
}

/** One candle of the stacked-zone window: its prices as the wire carries them, opening and closing on its low. */
function zoneWindowCandle(index: number, low: string, high: string): Candle {
  return {
    timeMs: zoneWindowOpenMs(index),
    open: low,
    high,
    low,
    close: low,
    tickVolume: 120,
    spread: 2,
    realVolume: 120,
  };
}

/** The window the zone is drawn in: the fixture bar reaching up through it, every other bar well below it. */
function zoneWindow(): Candle[] {
  return Array.from({ length: ZONE_WINDOW_BARS }, (_, index) =>
    index === ZONE_BAR_INDEX
      ? zoneWindowCandle(index, '1.0840', ZONE_BAR_HIGH)
      : zoneWindowCandle(index, '1.0825', LATER_BAR_HIGH),
  );
}

/** One fixture row the host flagged as a buy imbalance: both sides traded alike, so only the flag marks it. */
function stackedRow(rowNumber: number, downPrice: string, upPrice: string): ChartFootprintRow {
  return {
    row: rowNumber,
    downPrice,
    upPrice,
    buyVolume: ROW_VOLUME.toFixed(2),
    sellVolume: ROW_VOLUME.toFixed(2),
    buyTrades: ROW_TRADES,
    sellTrades: ROW_TRADES,
    buyImbalance: true,
    sellImbalance: false,
  };
}

/** The footprint of the fixture bar: three consecutive rows of one side, which stack into one zone. */
function stackedFootprintEvent(): ChartFootprintEvent {
  return {
    ...FOOTPRINT_EVENT,
    bars: [
      {
        ...FOOTPRINT_EVENT.bars[0],
        openMs: zoneWindowOpenMs(ZONE_BAR_INDEX),
        rows: [stackedRow(0, '1.085', '1.0852'), stackedRow(1, '1.0852', '1.0854'), stackedRow(2, '1.0854', '1.0856')],
        buyVolume: (ROW_VOLUME * 3).toFixed(2),
        sellVolume: (ROW_VOLUME * 3).toFixed(2),
        buyTrades: ROW_TRADES * 3,
        sellTrades: ROW_TRADES * 3,
      },
    ],
  };
}

/** `Wed 21 Oct '26  21:15`: the chart's default time format for a bar time, computed here from the stub clock. */
function chartTimeLabelOf(timeMs: number): string {
  const moment = new Date(timeMs);
  const clock = `${String(moment.getUTCHours()).padStart(2, '0')}:${String(moment.getUTCMinutes()).padStart(2, '0')}`;
  const year = String(moment.getUTCFullYear()).slice(-2);
  const weekday = WEEKDAY_NAMES[moment.getUTCDay()];
  return `${weekday} ${moment.getUTCDate()} ${MONTH_NAMES[moment.getUTCMonth()]} '${year}  ${clock}`;
}

/** The bar time the host stopped reading inside, as the chart's own time format writes it. */
const INCOMPLETE_BEFORE_LABEL = chartTimeLabelOf(NEWEST_BAR_OPEN_MS);
/** The notice the legend shows while the host read the window only part way in and counts trades. */
const EXPECTED_NOTICE = `Footprint: incomplete tick data before ${INCOMPLETE_BEFORE_LABEL} · volume = tick count`;

/** Picks `label` in the chart header's bar type menu. */
async function chooseBarStyle(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Bar type', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Bar type' });
  await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
}

/** The settings every `set_chart_footprint` call carried, oldest first, as the stub recorded them. */
async function footprintSettings(page: Page): Promise<unknown[]> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'set_chart_footprint').map((entry) => entry.args.settings);
}

/** The bar style series as the dev hook shows it. */
async function barStyle(page: Page) {
  return page.evaluate(() => window.__chartTest!.barStyle());
}

/** The bar spacing the dev hook's latest time-scale write left, in css px per bar. */
async function barSpacing(page: Page): Promise<number> {
  const spacing = await page.evaluate(() => window.__chartTest!.viewportChanges().at(-1)?.after.barSpacing);
  if (spacing === undefined) {
    throw new Error('The dev hook recorded no time-scale write to read the bar spacing from.');
  }
  return spacing;
}

/** Every pixel of a screenshot. */
function wholeImage(image: DecodedPng): PixelRegion {
  return { left: 0, right: image.width, top: 0, bottom: image.height - 1 };
}

/** The pane as one screenshot, decoded after the browser painted the frame it should show. */
async function paneImage(page: Page): Promise<DecodedPng> {
  await waitTwoAnimationFrames(page);
  return decodePng(await page.locator('.chart-host').screenshot());
}

/** The lowest screenshot row the bar's cells paint in `colors`, which the summary under them starts below. */
function cellsBottom(image: DecodedPng, colors: readonly PixelChannels[]): number {
  const region = wholeImage(image);
  const rows = colors.flatMap((color) => sitesPainting(image, color, region).map((site) => site.y));
  if (rows.length === 0) {
    throw new Error('The bar painted none of its cells in the fixture colours.');
  }
  return Math.max(...rows);
}

/** The part of the pane above the cells, where only the cells' own paint sits. */
function aboveCells(image: DecodedPng, boundary: number): PixelRegion {
  return { left: 0, right: image.width, top: 0, bottom: boundary - 1 };
}

/** The part of the pane under the cells, where the side totals and the summary box are written. */
function belowCells(image: DecodedPng, boundary: number): PixelRegion {
  return { left: 0, right: image.width, top: boundary + 2, bottom: image.height - 1 };
}

/**
 * Opens the chart on the saved footprint style and waits for the fixture footprint to reach its series, over the
 * stub's own window or over the recorded history a test scripts.
 */
async function openFootprintChart(page: Page, event: ChartFootprintEvent, recordedHistory?: RecordedHistory[]) {
  const collected = await gotoWithStub(page, {
    chartFootprintEvent: event,
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'volumeFootprint' } },
    ...(recordedHistory === undefined ? {} : { recordedHistory }),
  });
  await openChart(page);
  await expect.poll(async () => (await barStyle(page)).points.filter((point) => 'footprint' in point)).toHaveLength(1);
  return collected;
}

/** The pane's own columns of a screenshot, without the price axis the last-value label is drawn on. */
async function paneColumns(page: Page, image: DecodedPng): Promise<PixelRegion> {
  const axisWidth = await page.evaluate(() => window.__chartTest!.priceScale().axisWidth);
  return { left: 0, right: image.width - axisWidth, top: 0, bottom: image.height - 1 };
}

/** The pane's columns right of the fixture bar's body, which only a zone reaching right of it paints in its colour. */
function rightOfBar(pane: PixelRegion, barX: number): PixelRegion {
  // At the footprint zoom a body covers four fifths of the bar spacing around its x, so half a spacing clears it.
  return { ...pane, left: Math.ceil(barX + FOOTPRINT_BAR_SPACING / 2) };
}

/** The media x of the bar the stacked footprint belongs to, in the pixels the pane's screenshot is taken in. */
function stackedZoneBarX(page: Page): Promise<number> {
  return page.evaluate((timeMs) => window.__chartTest!.timeToX(timeMs), zoneWindowOpenMs(ZONE_BAR_INDEX));
}

/** The media y of `price`, in the pixels the pane's screenshot is taken in. */
function stackedZonePriceY(page: Page, price: number): Promise<number> {
  return page.evaluate((value) => window.__chartTest!.priceToY(value), price);
}

/**
 * The pane rows the stacked zone spans: from the y of its highest row's upPrice to the y of its lowest row's
 * downPrice, plus the css px the edge lines above and below it paint in.
 */
function stackedZoneRows(topY: number, bottomY: number): Pick<PixelRegion, 'top' | 'bottom'> {
  // The suite's one-to-one pixel ratio keeps a css px in one device pixel, as it does for the imbalance marks.
  return { top: Math.floor(topY) - ZONE_EDGE_MARGIN, bottom: Math.ceil(bottomY) + ZONE_EDGE_MARGIN };
}

/**
 * The pane region the stacked zone paints on `image`: the fixture bar's x, the y of the run's highest upPrice and
 * lowest downPrice, and the pane's own columns, each read from the live chart rather than kept from an earlier
 * frame, since the footprint zoom and the price autoscale can settle after the style's first paint.
 */
async function stackedZoneRegion(page: Page, image: DecodedPng): Promise<PixelRegion> {
  const rows = stackedFootprintEvent().bars[0].rows;
  return {
    ...rightOfBar(await paneColumns(page, image), await stackedZoneBarX(page)),
    ...stackedZoneRows(
      await stackedZonePriceY(page, Number(rows.at(-1)!.upPrice)),
      await stackedZonePriceY(page, Number(rows[0].downPrice)),
    ),
  };
}

/** Every pixel of `region` that lies on the wash a stacked zone's fill leaves over the pane's background. */
function zoneWashes(image: DecodedPng, region: PixelRegion): PixelSite[] {
  return sitesTintedToward(image, BUY_IMBALANCE, PANE_BACKGROUND, region, MIN_ZONE_FILL_SHARE);
}

/** The start of every horizontal run of `region` that paints a stacked zone's full-colour edge. */
function zoneEdges(image: DecodedPng, region: PixelRegion): PixelSite[] {
  return horizontalRunsPainting(image, BUY_IMBALANCE, region, MIN_ZONE_EDGE_RUN);
}

test('choosing Volume footprint asks the host for the default rows and paints both cells', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartFootprintEvent: FOOTPRINT_EVENT });
  await openChart(page);

  await chooseBarStyle(page, 'Volume footprint');

  await expect.poll(async () => (await footprintSettings(page))[0]).toEqual(DEFAULT_FOOTPRINT_REQUEST);
  await expect.poll(async () => (await barStyle(page)).points.filter((point) => 'footprint' in point)).toHaveLength(1);

  const image = await paneImage(page);
  const region = wholeImage(image);
  expect(horizontalRunsPainting(image, SELL_LIGHTEST, region, MIN_CELL_RUN).length).toBeGreaterThan(0);
  expect(horizontalRunsPainting(image, BUY_LIGHTEST, region, MIN_CELL_RUN).length).toBeGreaterThan(0);
  expectNoErrors(collected);
});

test('a bar writes each side total under its column and the delta box below them', async ({ page }) => {
  const collected = await openFootprintChart(page, FOOTPRINT_EVENT);

  const image = await paneImage(page);
  const boundary = cellsBottom(image, [SELL_LIGHTEST, BUY_LIGHTEST]);
  const above = aboveCells(image, boundary);
  const below = belowCells(image, boundary);

  // The appearance's defaults reach the series' own options, which the renderer paints from.
  expect((await barStyle(page)).options).toMatchObject(DEFAULT_FOOTPRINT_SETTINGS);

  // The two totals and the box's two lines are written under the lowest row, and nowhere above it. Ten px text is
  // anti-aliased onto the pane background, so only its cores reach the colour exactly: each is read as the pixels
  // lying on the blend from the pane background toward its colour.
  expect(sitesTintedToward(image, SELL_TOTAL, PANE_BACKGROUND, below).length).toBeGreaterThan(0);
  expect(sitesTintedToward(image, BUY_TOTAL, PANE_BACKGROUND, below).length).toBeGreaterThan(0);
  expect(sitesTintedToward(image, DELTA_NEUTRAL, PANE_BACKGROUND, below).length).toBeGreaterThan(0);
  expect(horizontalRunsPainting(image, SUMMARY_BOX_BORDER, below, MIN_SUMMARY_BOX_RUN).length).toBeGreaterThan(0);
  expect(sitesTintedToward(image, SELL_TOTAL, PANE_BACKGROUND, above)).toEqual([]);
  expect(sitesTintedToward(image, BUY_TOTAL, PANE_BACKGROUND, above)).toEqual([]);
  expectNoErrors(collected);
});

test('an imbalanced cell is marked on its outer edge in its own side colour', async ({ page }) => {
  const collected = await openFootprintChart(page, imbalancedFootprintEvent());

  const image = await paneImage(page);
  const above = aboveCells(image, cellsBottom(image, [SELL_LIGHTEST, BUY_LIGHTEST]));

  // Three css px wide, and the only paint of their colour inside the bar: the cells are the lightest shade.
  expect(horizontalRunsPainting(image, SELL_IMBALANCE, above, IMBALANCE_MARK_RUN).length).toBeGreaterThan(0);
  expect(horizontalRunsPainting(image, BUY_IMBALANCE, above, IMBALANCE_MARK_RUN).length).toBeGreaterThan(0);
  expectNoErrors(collected);
});

test('the legend says the data is incomplete and counted in ticks, and clears when the style leaves', async ({
  page,
}) => {
  const collected = await gotoWithStub(page, { chartFootprintEvent: incompleteFootprintEvent() });
  await openChart(page);
  await chooseBarStyle(page, 'Volume footprint');

  const notice = page.locator('.chart-footprint-notice');
  await expect(notice).toHaveText(EXPECTED_NOTICE);

  await chooseBarStyle(page, 'Candles');
  // A quiet legend holds only its own spans, so the notice leaves the DOM rather than staying empty.
  await expect(notice).toHaveCount(0);
  expectNoErrors(collected);
});

test('choosing Volume footprint zooms the bars in, and leaving it restores the user zoom', async ({ page }) => {
  const collected = await gotoWithStub(page, { chartFootprintEvent: FOOTPRINT_EVENT });
  await openChart(page);
  const userSpacing = await barSpacing(page);
  expect(userSpacing).toBeLessThan(FOOTPRINT_BAR_SPACING);

  await chooseBarStyle(page, 'Volume footprint');
  await expect.poll(() => barSpacing(page)).toBe(FOOTPRINT_BAR_SPACING);

  await chooseBarStyle(page, 'Candles');
  await expect.poll(() => barSpacing(page)).toBe(userSpacing);
  expectNoErrors(collected);
});

test('a bar the host holds no footprint for draws as a plain candle', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'volumeFootprint' } },
  });
  await openChart(page);
  await expect.poll(async () => (await barStyle(page)).seriesType).toBe('Custom');

  const points = (await barStyle(page)).points;
  expect(points.length).toBeGreaterThan(0);
  expect(points.filter((point) => 'footprint' in point)).toEqual([]);

  const image = await paneImage(page);
  const region = wholeImage(image);
  expect(sitesPainting(image, UP_CANDLE, region).length).toBeGreaterThan(0);
  expect(horizontalRunsPainting(image, SELL_LIGHTEST, region, MIN_CELL_RUN)).toEqual([]);
  expect(horizontalRunsPainting(image, BUY_LIGHTEST, region, MIN_CELL_RUN)).toEqual([]);
  expectNoErrors(collected);
});

test('leaving the style turns the host footprint off again', async ({ page }) => {
  const collected = await gotoWithStub(page, {
    chartFootprintEvent: FOOTPRINT_EVENT,
    chartSettingOverrides: { [EURUSD_CHART]: { barStyle: 'volumeFootprint' } },
  });
  await openChart(page);
  await expect.poll(async () => (await footprintSettings(page)).at(-1)).toEqual(DEFAULT_FOOTPRINT_REQUEST);

  await chooseBarStyle(page, 'Candles');

  await expect.poll(async () => (await footprintSettings(page)).at(-1)).toBeNull();
  expectNoErrors(collected);
});

/**
 * How many cell columns one row of the pane paints in `colors`: the fewest runs any painted row holds, so the
 * numbers written inside the cells cannot split one column into more.
 */
function paintedColumns(image: DecodedPng, colors: readonly PixelChannels[], region: PixelRegion): number {
  const runsPerRow = new Map<number, number>();
  for (const site of colors.flatMap((color) => horizontalRunsPainting(image, color, region, MIN_CELL_RUN))) {
    runsPerRow.set(site.y, (runsPerRow.get(site.y) ?? 0) + 1);
  }
  if (runsPerRow.size === 0) {
    return 0;
  }
  return Math.min(...runsPerRow.values());
}

test('the Symbol tab lists the footprint, imbalance and label rows with the defaults the bars are drawn with', async ({
  page,
}) => {
  const collected = await openFootprintChart(page, FOOTPRINT_EVENT);
  const dialog = await openChartSettingsTab(page, 'Symbol');

  for (const heading of ['Volume footprint', 'Imbalance', 'Labels']) {
    await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole('button', { name: 'Row size', exact: true })).toHaveText('Auto (ATR)');
  await expect(dialog.getByRole('spinbutton', { name: 'ATR length', exact: true })).toHaveValue('14');
  // Only one of the two row widths is drawn: the manual one appears with the manual row size.
  await expect(dialog.getByRole('spinbutton', { name: 'Ticks per row', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Display', exact: true })).toHaveText('Cluster');
  await expect(dialog.getByRole('button', { name: 'Type', exact: true })).toHaveText('Buy and Sell');
  await expect(dialog.getByRole('button', { name: 'Values', exact: true })).toHaveText('Volume');
  await expect(dialog.getByRole('checkbox', { name: 'Apply gradient to background', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Value area', exact: true })).toBeChecked();
  await expect(dialog.getByRole('spinbutton', { name: 'Value area size', exact: true })).toHaveValue('70');
  await expect(dialog.getByRole('spinbutton', { name: 'Imbalance', exact: true })).toHaveValue('300');
  await expect(dialog.getByRole('checkbox', { name: 'Highlighting', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Stacked levels', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('spinbutton', { name: 'Levels in a stack', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'POC', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Show summary info', exact: true })).toBeChecked();

  // Four shades a side, each a swatch of its own, from the lightest to the darkest.
  for (const side of ['Sell background', 'Buy background']) {
    await expect(dialog.getByRole('button', { name: new RegExp(`^${side} colour \\d$`) })).toHaveCount(4);
  }
  const sellLightest = dialog.getByRole('button', { name: 'Sell background colour 1', exact: true });
  const buyDarkest = dialog.getByRole('button', { name: 'Buy background colour 4', exact: true });
  await expect(sellLightest.locator('.color-face-fill')).toHaveCSS('background-color', 'rgb(255, 153, 160)');
  await expect(buyDarkest.locator('.color-face-fill')).toHaveCSS('background-color', 'rgb(0, 77, 64)');
  expectNoErrors(collected);
});

test('choosing Delta redraws the bar as one column where Buy and Sell drew two', async ({ page }) => {
  const collected = await openFootprintChart(page, FOOTPRINT_EVENT);

  const before = await paneImage(page);
  const beforeRegion = wholeImage(before);
  expect(paintedColumns(before, [SELL_LIGHTEST, BUY_LIGHTEST], beforeRegion)).toBe(2);

  const dialog = await openChartSettingsTab(page, 'Symbol');
  await chooseOption(dialog.getByRole('button', { name: 'Type', exact: true }), 'Delta');
  await expect.poll(async () => (await barStyle(page)).options.type).toBe('delta');
  // OK keeps the edit and closes the dialog, so the pane is read with no backdrop over it.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);

  const after = await paneImage(page);
  const afterRegion = wholeImage(after);
  // The fixture's rows traded both sides alike, so every delta is zero: one neutral column right of the candle.
  expect(paintedColumns(after, [NEUTRAL_CELL], afterRegion)).toBe(1);
  expect(horizontalRunsPainting(after, SELL_LIGHTEST, afterRegion, MIN_CELL_RUN)).toEqual([]);
  expect(horizontalRunsPainting(after, BUY_LIGHTEST, afterRegion, MIN_CELL_RUN)).toEqual([]);
  expectNoErrors(collected);
});

test('choosing manual rows sends the host the tick count it must compute the rows with', async ({ page }) => {
  const collected = await openFootprintChart(page, FOOTPRINT_EVENT);
  const dialog = await openChartSettingsTab(page, 'Symbol');

  await chooseOption(dialog.getByRole('button', { name: 'Row size', exact: true }), 'Manual');
  const manualRequest = { ...DEFAULT_FOOTPRINT_REQUEST, rowSize: { kind: 'manual', ticksPerRow: 10 } };
  await expect.poll(async () => (await footprintSettings(page)).at(-1)).toEqual(manualRequest);

  await dialog.getByRole('spinbutton', { name: 'Ticks per row', exact: true }).fill('5');
  const tickRequest = { ...DEFAULT_FOOTPRINT_REQUEST, rowSize: { kind: 'manual', ticksPerRow: 5 } };
  await expect.poll(async () => (await footprintSettings(page)).at(-1)).toEqual(tickRequest);
  expectNoErrors(collected);
});

/** How many sites `sites` finds in the zone's rows of a fresh pane image, read against that image's own layout. */
async function zoneSiteCount(
  page: Page,
  sites: (image: DecodedPng, region: PixelRegion) => PixelSite[],
): Promise<number> {
  const image = await paneImage(page);
  return sites(image, await stackedZoneRegion(page, image)).length;
}

test('Stacked levels bands a run of buy imbalances right of its bar, and no band draws while it is off', async ({
  page,
}) => {
  const collected = await openFootprintChart(page, stackedFootprintEvent(), [
    { symbol: 'EURUSD', timeframe: 'M5', candles: zoneWindow() },
  ]);

  // The footprint zoom can still settle after the style's first paint, so no region is taken until the bar's x
  // reads the same twice in a row.
  await expect
    .poll(async () => {
      const barX = await stackedZoneBarX(page);
      await page.waitForTimeout(100);
      return barX === (await stackedZoneBarX(page));
    })
    .toBe(true);

  // The style starts with stacked levels off, so nothing in the zone's own rows right of the fixture bar carries
  // its side's colour. The rows are bounded to the zone's prices, since the whole pane height right of the bar also
  // holds the legend's notice and other paint of that colour.
  const off = await paneImage(page);
  const offRegion = await stackedZoneRegion(page, off);
  expect(zoneWashes(off, offRegion)).toEqual([]);
  expect(zoneEdges(off, offRegion)).toEqual([]);

  const dialog = await openChartSettingsTab(page, 'Symbol');
  await dialog.getByRole('checkbox', { name: 'Stacked levels', exact: true }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await barStyle(page)).options.stackedImbalance).toMatchObject({ visible: true });

  // The bar's three imbalanced rows stack into a zone, which washes the pane from the bar's right edge to the
  // pane's own edge and is edged on its top and bottom by the full colour the imbalance marks are drawn in.
  await expect.poll(() => zoneSiteCount(page, zoneWashes)).toBeGreaterThan(0);
  await expect.poll(() => zoneSiteCount(page, zoneEdges)).toBeGreaterThan(0);

  // Highlighting off takes the cells' marks away and leaves the zones, which no highlighting switch reaches.
  await openChartSettingsTab(page, 'Symbol');
  await dialog.getByRole('checkbox', { name: 'Highlighting', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await barStyle(page)).options.imbalanceHighlight).toMatchObject({ visible: false });

  await expect.poll(() => zoneSiteCount(page, zoneWashes)).toBeGreaterThan(0);
  expectNoErrors(collected);
});
