/*
 * The volume profile loader: a tiny mirrored BID/ASK profile (dashed centre line, red bars growing left,
 * teal bars right) whose bars each ease independently. Shared by the fixed range profile tool and the
 * app-wide loading message, so both wait with the same animation.
 */
export const LOADER_ROW_COUNT = 5;
export const LOADER_ROW_HEIGHT = 4;
export const LOADER_ROW_GAP = 2;
export const LOADER_MIN_WIDTH = 3;
export const LOADER_MAX_WIDTH = 18;
/** Vertical overhang of the dashed centre line beyond the first and last row. */
export const LOADER_LINE_MARGIN = 3;
/** Each bar holds a step for its own duration, `BASE` plus 0..4 increments of `SPREAD`, so bars never change in sync. */
const LOADER_STEP_BASE_MS = 350;
const LOADER_STEP_SPREAD_MS = 50;
const LOADER_STEP_SPREAD_COUNT = 5;
const LOADER_LINE_DASH = [4, 3];
const LOADER_ROWS_HEIGHT = LOADER_ROW_COUNT * LOADER_ROW_HEIGHT + (LOADER_ROW_COUNT - 1) * LOADER_ROW_GAP;
/** Height of the whole loader in CSS px, centre line overhang included. */
export const PROFILE_LOADER_HEIGHT = LOADER_ROWS_HEIGHT + 2 * LOADER_LINE_MARGIN;
/** Width of the whole loader in CSS px: mirrored halves of at most `LOADER_MAX_WIDTH` each. */
export const PROFILE_LOADER_WIDTH = 2 * LOADER_MAX_WIDTH;

/** Colours of the loader's bars and centre line. */
export interface ProfileLoaderColors {
  bid: string;
  ask: string;
  line: string;
}

/** Deterministic integer hash of (bar, step) to [0, 1): a murmur-style finaliser, so targets look random. */
function hashUnit(bar: number, step: number): number {
  let h = Math.imul(bar + 1, 0x9e3779b1) ^ Math.imul(step | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function loaderBarWidth(bar: number, nowMs: number): number {
  const stepMs = LOADER_STEP_BASE_MS + ((bar * 3) % LOADER_STEP_SPREAD_COUNT) * LOADER_STEP_SPREAD_MS;
  const step = Math.floor(nowMs / stepMs);
  const progress = nowMs / stepMs - step;
  const eased = progress * progress * (3 - 2 * progress);
  const from = hashUnit(bar, step - 1);
  const to = hashUnit(bar, step);
  return LOADER_MIN_WIDTH + (LOADER_MAX_WIDTH - LOADER_MIN_WIDTH) * (from + (to - from) * eased);
}

/**
 * Bar half-widths of the loader's rows at `nowMs`: every bar (row and side) eases with a smoothstep from its
 * previous pseudo-random target to the next one, each on its own step length, so the bars shrink and grow
 * independently. Pure: the targets come from an integer hash, not from `Math.random`.
 */
export function loaderRowWidths(nowMs: number): Array<{ bid: number; ask: number }> {
  return Array.from({ length: LOADER_ROW_COUNT }, (_, row) => ({
    bid: loaderBarWidth(row * 2, nowMs),
    ask: loaderBarWidth(row * 2 + 1, nowMs),
  }));
}

/** Paints the dashed centre line of the loader, overhanging the rows by `LOADER_LINE_MARGIN` at both ends. */
function strokeLoaderLine(ctx: CanvasRenderingContext2D, centerX: number, top: number, color: string): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.setLineDash(LOADER_LINE_DASH);
  ctx.beginPath();
  ctx.moveTo(centerX, top - LOADER_LINE_MARGIN);
  ctx.lineTo(centerX, top + LOADER_ROWS_HEIGHT + LOADER_LINE_MARGIN);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Fills one mirrored row: the BID bar growing left of `centerX`, the ASK bar growing right of it. */
function fillLoaderRow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  rowTop: number,
  row: { bid: number; ask: number },
  colors: ProfileLoaderColors,
): void {
  ctx.fillStyle = colors.bid;
  ctx.fillRect(centerX - row.bid, rowTop, row.bid, LOADER_ROW_HEIGHT);
  ctx.fillStyle = colors.ask;
  ctx.fillRect(centerX, rowTop, row.ask, LOADER_ROW_HEIGHT);
}

/** Draws the loader centred on (`centerX`, `middleY`); `nowMs` only sets the bar widths. */
export function drawProfileLoader(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  middleY: number,
  nowMs: number,
  colors: ProfileLoaderColors,
): void {
  const top = middleY - LOADER_ROWS_HEIGHT / 2;
  ctx.save();
  ctx.globalAlpha = 1;
  strokeLoaderLine(ctx, centerX, top, colors.line);
  loaderRowWidths(nowMs).forEach((row, index) => {
    const rowTop = top + index * (LOADER_ROW_HEIGHT + LOADER_ROW_GAP);
    fillLoaderRow(ctx, centerX, rowTop, row, colors);
  });
  ctx.restore();
}
