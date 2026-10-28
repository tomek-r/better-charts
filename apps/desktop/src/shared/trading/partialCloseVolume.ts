// Pure partial-close volume rules. They mirror the Rust domain module exactly
// and use exact decimal arithmetic (BigInt units of the finest decimal place):
// volumes are never converted to floating point.

import { formatVolume, volumeWithUnit } from '../format';

/** Volumes of one position, as decimal strings. `min`/`step` come from the broker symbol. */
export interface PartialCloseLimits {
  volume: string;
  min: string;
  step: string;
}

/** Structural subset of a position the rules need (kept free of bridge types). */
export interface PartialCloseSource {
  volume: string;
  volumeMin?: string | null;
  volumeStep?: string | null;
}

export const PARTIAL_CLOSE_PERCENTS = [25, 50, 75] as const;

export type PartialVolumeIssue = 'unreadable' | 'below-min' | 'above-position' | 'off-step' | 'remainder-below-min';

export type PartialVolumeCheck =
  { ok: true; volume: string; closesAll: boolean } | { ok: false; issue: PartialVolumeIssue };

interface ParsedDecimal {
  units: bigint;
  /** Fraction digits after stripping trailing zeros. */
  places: number;
}

interface ScaledLimits {
  /** Fraction digits the integer units are expressed in (may exceed `displayPlaces` for a long typed value). */
  scale: number;
  /** Fraction digits the exact arithmetic keeps: the finest of volume, min and step, ignoring the EA's trailing zero padding. */
  displayPlaces: number;
  volume: bigint;
  min: bigint;
  step: bigint;
}

const DECIMAL = /^\d+(?:\.\d*)?$/;

function parseDecimal(text: string): ParsedDecimal | undefined {
  const normalized = text.trim().replace(',', '.');
  if (!DECIMAL.test(normalized)) {
    return undefined;
  }
  const [whole, fraction = ''] = normalized.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return { units: BigInt(whole + trimmed), places: trimmed.length };
}

function unitsAt(decimal: ParsedDecimal, scale: number): bigint {
  return decimal.units * 10n ** BigInt(scale - decimal.places);
}

function formatUnits(units: bigint, scale: number): string {
  if (scale === 0) {
    return units.toString();
  }
  const digits = units.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Renders units with the shared display rule; callers pass step multiples, so the dropped digits are zeros. */
function formatDisplay(units: bigint, scaled: ScaledLimits): string {
  return formatVolume(formatUnits(units / 10n ** BigInt(scaled.scale - scaled.displayPlaces), scaled.displayPlaces));
}

function scaleLimits(limits: PartialCloseLimits, minimumScale = 0): ScaledLimits | undefined {
  const volume = parseDecimal(limits.volume);
  const min = parseDecimal(limits.min);
  const step = parseDecimal(limits.step);
  if (!volume || !min || !step || min.units === 0n || step.units === 0n) {
    return undefined;
  }
  const displayPlaces = Math.max(volume.places, min.places, step.places);
  const scale = Math.max(displayPlaces, minimumScale);
  return { scale, displayPlaces, volume: unitsAt(volume, scale), min: unitsAt(min, scale), step: unitsAt(step, scale) };
}

/** Splittable: at least two minimum lots, so one valid part and a valid remainder exist. */
function isSplittable(scaled: ScaledLimits): boolean {
  return scaled.volume >= scaled.min * 2n && scaled.volume % scaled.step === 0n;
}

/**
 * Limits for a position, or undefined when partial close must not be offered:
 * capability off, broker min/step unknown, or the position cannot be split.
 */
export function partialCloseLimits(position: PartialCloseSource, capability: boolean): PartialCloseLimits | undefined {
  if (!capability || !position.volumeMin || !position.volumeStep) {
    return undefined;
  }
  const limits = { volume: position.volume, min: position.volumeMin, step: position.volumeStep };
  const scaled = scaleLimits(limits);
  return scaled && isSplittable(scaled) ? limits : undefined;
}

/** Popover title shared by every surface that opens the custom-volume form, e.g. `Close part of EURUSD BUY`. */
export function partialCloseTitle(position: { symbol: string; side: string }): string {
  return `Close part of ${position.symbol} ${position.side.toUpperCase()}`;
}

export function checkPartialVolume(limits: PartialCloseLimits, text: string): PartialVolumeCheck {
  const requested = parseDecimal(text);
  const probe = requested ? scaleLimits(limits, requested.places) : undefined;
  if (!requested || !probe) {
    return { ok: false, issue: 'unreadable' };
  }
  const value = unitsAt(requested, probe.scale);
  if (value < probe.min) {
    return { ok: false, issue: 'below-min' };
  }
  if (value > probe.volume) {
    return { ok: false, issue: 'above-position' };
  }
  if (value % probe.step !== 0n) {
    return { ok: false, issue: 'off-step' };
  }
  const remainder = probe.volume - value;
  if (remainder !== 0n && remainder < probe.min) {
    return { ok: false, issue: 'remainder-below-min' };
  }
  return { ok: true, volume: formatDisplay(value, probe), closesAll: remainder === 0n };
}

/** `percent` of the position rounded down to the lot step; undefined when that is not a valid partial volume. */
export function presetVolume(limits: PartialCloseLimits, percent: number): string | undefined {
  const scaled = scaleLimits(limits);
  if (!scaled) {
    return undefined;
  }
  const raw = (scaled.volume * BigInt(percent)) / 100n;
  const rounded = raw - (raw % scaled.step);
  const text = formatDisplay(rounded, scaled);
  const check = checkPartialVolume(limits, text);
  return check.ok && !check.closesAll ? check.volume : undefined;
}

/** Snaps typed text down to the lot step; text that is not a number is returned unchanged. */
export function snapVolumeText(limits: PartialCloseLimits, text: string): string {
  const requested = parseDecimal(text);
  const probe = requested ? scaleLimits(limits, requested.places) : undefined;
  if (!requested || !probe) {
    return text;
  }
  const value = unitsAt(requested, probe.scale);
  return formatDisplay(value - (value % probe.step), probe);
}

/** One lot step up or down from the typed value, kept inside [min, position volume]. */
export function stepVolumeText(limits: PartialCloseLimits, text: string, direction: 1 | -1): string {
  const scaled = scaleLimits(limits);
  if (!scaled) {
    return text;
  }
  const requested = parseDecimal(text);
  const current = requested && requested.places <= scaled.scale ? unitsAt(requested, scaled.scale) : scaled.min;
  const floor = current - (current % scaled.step);
  const stepDown = current > floor ? floor : floor - scaled.step;
  const next = direction === 1 ? floor + scaled.step : stepDown;
  const atLeastMin = next < scaled.min ? scaled.min : next;
  return formatDisplay(atLeastMin > scaled.volume ? scaled.volume : atLeastMin, scaled);
}

/** Volume that stays open after closing `closed` (a value already accepted by checkPartialVolume). */
export function remainingVolume(limits: PartialCloseLimits, closed: string): string {
  const requested = parseDecimal(closed);
  const probe = requested ? scaleLimits(limits, requested.places) : undefined;
  if (!requested || !probe) {
    return limits.volume;
  }
  return formatDisplay(probe.volume - unitsAt(requested, probe.scale), probe);
}

/** Slider positions are whole lot steps (volume / step), so they stay exact as JS numbers. */
export interface VolumeSliderScale {
  /** Smallest selectable position: the minimum volume rounded up to a whole step. */
  min: number;
  /** Position of the full volume ("All"). */
  max: number;
}

/**
 * A remainder shorter than the minimum is invalid, so positions strictly between `lastPartial` and `max` are a gap.
 * Beyond the gap only whole-position closes remain, hence it is the highest partial position.
 */
function sliderBounds(scaled: ScaledLimits) {
  const min = (scaled.min + scaled.step - 1n) / scaled.step;
  const max = scaled.volume / scaled.step;
  const lastPartial = max - min < min ? min : max - min;
  return { min, max, lastPartial };
}

export function volumeSliderScale(limits: PartialCloseLimits): VolumeSliderScale | undefined {
  const scaled = scaleLimits(limits);
  if (!scaled) {
    return undefined;
  }
  const { min, max } = sliderBounds(scaled);
  return { min: Number(min), max: Number(max) };
}

/** Slider position of a valid volume text; undefined when the text is not a step multiple inside the range. */
export function volumeSliderPosition(limits: PartialCloseLimits, text: string): number | undefined {
  const check = checkPartialVolume(limits, text);
  const requested = check.ok ? parseDecimal(check.volume) : undefined;
  const probe = requested ? scaleLimits(limits, requested.places) : undefined;
  return requested && probe ? Number(unitsAt(requested, probe.scale) / probe.step) : undefined;
}

/** Exact volume text for a slider position (the position is clamped and snapped to a valid one first). */
export function sliderPositionVolume(limits: PartialCloseLimits, position: number): string {
  const scaled = scaleLimits(limits);
  if (!scaled) {
    return limits.volume;
  }
  const snapped = snapSliderPosition(limits, position);
  return formatDisplay(BigInt(snapped) * scaled.step, scaled);
}

/** Nearest valid position: clamped to the range, and a position in the invalid-remainder gap moves to its nearer edge. */
export function snapSliderPosition(limits: PartialCloseLimits, position: number): number {
  const scaled = scaleLimits(limits);
  if (!scaled || !Number.isFinite(position)) {
    return position;
  }
  const { min, max, lastPartial } = sliderBounds(scaled);
  const rounded = BigInt(Math.round(position));
  if (rounded <= min) {
    return Number(min);
  }
  if (rounded >= max) {
    return Number(max);
  }
  if (rounded <= lastPartial) {
    return Number(rounded);
  }
  // A tie keeps the partial close: it is the more conservative outcome.
  return Number(rounded - lastPartial <= max - rounded ? lastPartial : max);
}

/**
 * Snap after a slider move. Single-step moves (keyboard) continue in their direction across the gap, otherwise
 * nearest-edge snapping would pull the thumb back and the arrow key could never leave the last partial position.
 */
export function snapSliderMove(limits: PartialCloseLimits, from: number, to: number): number {
  const snapped = snapSliderPosition(limits, to);
  const scaled = scaleLimits(limits);
  if (!scaled || Math.abs(to - from) !== 1) {
    return snapped;
  }
  const { max, lastPartial } = sliderBounds(scaled);
  const inGap = BigInt(to) > lastPartial && BigInt(to) < max;
  if (!inGap) {
    return snapped;
  }
  return Number(to > from ? max : lastPartial);
}

export function fullVolume(limits: PartialCloseLimits): string {
  const scaled = scaleLimits(limits);
  return scaled ? formatDisplay(scaled.volume, scaled) : limits.volume;
}

/** Inline error copy; step mismatches stay silent because typed values snap to the step on blur. */
export function partialVolumeMessage(issue: PartialVolumeIssue, limits: PartialCloseLimits): string | undefined {
  switch (issue) {
    case 'unreadable':
    case 'below-min':
      return `Enter at least ${volumeWithUnit(limits.min)}.`;
    case 'above-position':
      return `The position is only ${volumeWithUnit(limits.volume)}.`;
    case 'remainder-below-min':
      return `The amount left would be below the ${volumeWithUnit(limits.min)} minimum. Close all instead.`;
    case 'off-step':
      return undefined;
  }
}
