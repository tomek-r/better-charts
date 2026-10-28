import { readTimeframeVisibility, type DrawingTimeframeVisibility } from './timeframeVisibility';
import { isPlainRecord, isToolInputValues, type ToolInputValues } from './toolInputs';

/**
 * A drawing as the engine carries it: its settings and the anchor points its own tool wrote.
 * Every tool stores the same ordered point list, so the engine can check the shape of any
 * record without knowing which tool drew it.
 */

/**
 * One anchor of a drawing: the epoch milliseconds of the slot it holds, the price it holds as
 * decimal text, or both. At least one of the two is set.
 */
export interface ChartDrawingPoint {
  readonly timeMs: number | null;
  /** Decimal text, so a stored price is never re-rounded on its way back to the chart. */
  readonly price: string | null;
}

/** What one tool exports and imports: one of its drawings. */
export interface ChartToolDrawingRecord {
  readonly id: string;
  /** A locked drawing ignores edit gestures until it is unlocked. */
  readonly locked: boolean;
  /** Whether the drawing is painted; hiding is stored, and its behaviour arrives separately. */
  readonly visible: boolean;
  readonly inputs: ToolInputValues;
  /** The anchors, in paint order. */
  readonly points: readonly ChartDrawingPoint[];
}

/** What the app stores: one tool's drawing, stamped with the tool that owns it. */
export interface ChartDrawingRecord extends ChartToolDrawingRecord {
  readonly toolId: string;
  /**
   * Whether the drawing is stacked below the price bars; drawings keep their list order on both
   * sides of the bars.
   */
  readonly belowBars: boolean;
  /**
   * On which timeframes the drawing paints. Like `belowBars` it belongs to the tool set, not to the
   * tool's own record, and a payload stored before it existed reads as shown everywhere.
   */
  readonly timeframeVisibility: DrawingTimeframeVisibility;
}

/** The drawing the user picked: which tool owns it, and whether it is locked and shown. */
export interface ChartDrawingSelection {
  readonly toolId: string;
  readonly drawingId: string;
  readonly locked: boolean;
  readonly visible: boolean;
}

/** The most anchor points one drawing may carry, as the backend enforces. */
const MAX_POINTS_PER_DRAWING = 2000;
/** Longest accepted price text: a full decimal, never an exponent. */
const MAX_PRICE_CHARS = 32;
/** Most fraction digits the price text of a number may carry; `toLocaleString` allows no more. */
const MAX_PRICE_FRACTION_DIGITS = 20;
/** Plain decimal text: an optional sign, digits, and an optional fraction of digits. */
const DECIMAL_PRICE = /^-?\d+(?:\.\d+)?$/;

function isPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Whether `text` is decimal price text, the shape the backend accepts and never re-rounds. */
function isDecimalPriceText(text: string): boolean {
  return text.length <= MAX_PRICE_CHARS && DECIMAL_PRICE.test(text);
}

/**
 * Shape check of one stored drawing: its ids, its flags, its settings map and its anchor points.
 * Nothing about a tool's own meaning of the points is checked here.
 */
export function readChartDrawingRecord(value: unknown): ChartDrawingRecord | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const { id, toolId, locked, visible, belowBars, timeframeVisibility, inputs, points } = value;
  if (!isPresentString(id) || !isPresentString(toolId)) {
    return undefined;
  }
  if (typeof locked !== 'boolean' || typeof visible !== 'boolean' || !isToolInputValues(inputs)) {
    return undefined;
  }
  const below = readBelowBars(belowBars);
  const anchors = readPoints(points);
  if (below === undefined || anchors === undefined) {
    return undefined;
  }
  return {
    id,
    toolId,
    locked,
    visible,
    belowBars: below,
    timeframeVisibility: readTimeframeVisibility(timeframeVisibility),
    inputs,
    points: anchors,
  };
}

/** Whether the drawing sits below the bars; a payload stored before the flag existed means false. */
function readBelowBars(value: unknown): boolean | undefined {
  if (value === undefined) {
    return false;
  }
  return typeof value === 'boolean' ? value : undefined;
}

/** An ordered point list, or undefined when it is not one: a drawing always anchors once. */
function readPoints(value: unknown): ChartDrawingPoint[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_POINTS_PER_DRAWING) {
    return undefined;
  }
  const points: ChartDrawingPoint[] = [];
  for (const entry of value) {
    const point = readPoint(entry);
    if (!point) {
      return undefined;
    }
    points.push(point);
  }
  return points;
}

function readPoint(value: unknown): ChartDrawingPoint | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const timeMs = readPointTime(value.timeMs);
  const price = readPointPrice(value.price);
  if (timeMs === undefined || price === undefined || (timeMs === null && price === null)) {
    return undefined;
  }
  return { timeMs, price };
}

/** Whole epoch milliseconds, or null for a price-only anchor; undefined when neither. */
function readPointTime(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return isFiniteInteger(value) ? value : undefined;
}

/** Decimal price text, or null for a time-only anchor; undefined when neither. */
function readPointPrice(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' && isDecimalPriceText(value) ? value : undefined;
}

/**
 * A number as decimal price text without an exponent, the form a record stores: a price placed at
 * `1.085` is stored and read back as `1.085`, never re-rounded.
 */
export function formatPointPrice(price: number): string {
  return price.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: MAX_PRICE_FRACTION_DIGITS });
}

/** The price a stored text names, or NaN when it is not decimal price text. */
export function parsePointPrice(text: string): number {
  return isDecimalPriceText(text) ? Number(text) : Number.NaN;
}

/** A fresh drawing id, unique across every drawing the app has saved. */
export function newChartDrawingId(): string {
  return crypto.randomUUID();
}
