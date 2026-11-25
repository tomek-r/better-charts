import { paneHeightField, timeframeVisibilityField, type SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { IndicatorPaneHeight } from '../chart/engine/indicators/indicatorLayer';
import type { SettingValues } from '../chart/engine/settings/settingInputs';

/**
 * Marks one saved indicator as hidden (or shown again) without touching the other entries.
 *
 * A shown entry carries no `hidden` key at all, so showing drops that one key and keeps every other field.
 */
export function withIndicatorHidden(
  indicators: readonly SavedIndicator[],
  instanceId: string,
  hidden: boolean,
): SavedIndicator[] {
  return indicators.map((indicator) => {
    if (indicator.instanceId !== instanceId) {
      return indicator;
    }
    return hidden ? { ...indicator, hidden: true } : withoutHiddenFlag(indicator);
  });
}

/**
 * Replaces the settings of one saved indicator and, when the caller names them, the timeframes it shows on,
 * leaving the other entries untouched. An absent visibility keeps the one the entry already stores.
 */
export function withIndicatorSettings(
  indicators: readonly SavedIndicator[],
  instanceId: string,
  settings: SettingValues,
  timeframeVisibility?: DrawingTimeframeVisibility,
): SavedIndicator[] {
  return indicators.map((indicator) => {
    if (indicator.instanceId !== instanceId) {
      return indicator;
    }
    if (timeframeVisibility === undefined) {
      return { ...indicator, settings };
    }
    return { ...withoutTimeframeVisibility(indicator), settings, ...timeframeVisibilityField(timeframeVisibility) };
  });
}

/**
 * Drops one saved indicator, leaving the other entries untouched.
 */
export function withoutIndicator(indicators: readonly SavedIndicator[], instanceId: string): SavedIndicator[] {
  return indicators.filter((indicator) => indicator.instanceId !== instanceId);
}

/**
 * Moves one saved indicator to the place another one holds, leaving every other entry as it is. The list is
 * the order of the object tree's rows, topmost first, so the moved indicator takes the target's row and the
 * entries between them keep theirs; the chart paints the first of the list over the ones under it.
 */
export function withIndicatorMoved(
  indicators: readonly SavedIndicator[],
  movedInstanceId: string,
  targetInstanceId: string,
): SavedIndicator[] {
  const movedIndex = indicators.findIndex((indicator) => indicator.instanceId === movedInstanceId);
  const targetIndex = indicators.findIndex((indicator) => indicator.instanceId === targetInstanceId);
  if (movedIndex === -1 || targetIndex === -1) {
    return [...indicators];
  }
  const moved = [...indicators];
  const [entry] = moved.splice(movedIndex, 1);
  moved.splice(targetIndex, 0, entry);
  return moved;
}

/**
 * Gives the named saved indicators the heights the user dragged their own panes to, leaving every other entry
 * untouched and the ones no height is named for as they are.
 */
export function withIndicatorPaneHeights(
  indicators: readonly SavedIndicator[],
  heights: readonly IndicatorPaneHeight[],
): SavedIndicator[] {
  const heightsByInstanceId = new Map(heights.map((entry) => [entry.instanceId, entry.paneHeight]));
  return indicators.map((indicator) => {
    const paneHeight = heightsByInstanceId.get(indicator.instanceId);
    if (paneHeight === undefined) {
      return indicator;
    }
    return { ...withoutPaneHeight(indicator), ...paneHeightField(paneHeight) };
  });
}

/**
 * Puts the price-pane indicators in the given top-to-bottom order and names how many of them stand over the price
 * bars, which is the side the chart paints them on. The indicators of the panes below keep their place among the
 * entries as they are, and so does every field the caller does not name. An id the order does not name, which is
 * what an order computed for another list looks like, leaves every entry where it is.
 */
export function withPricePaneOrder(
  indicators: readonly SavedIndicator[],
  order: readonly string[],
  aboveBars: number,
): SavedIndicator[] {
  const byInstanceId = new Map(indicators.map((indicator) => [indicator.instanceId, indicator]));
  const ordered = order.flatMap((instanceId) => {
    const entry = byInstanceId.get(instanceId);
    return entry === undefined ? [] : [entry];
  });
  if (ordered.length !== order.length) {
    return [...indicators];
  }
  const named = new Set(order);
  let place = 0;
  return indicators.map((indicator) => {
    if (!named.has(indicator.instanceId)) {
      return indicator;
    }
    const entry = ordered[place];
    place += 1;
    return sideOfBars(entry, place <= aboveBars);
  });
}

/** The entry on the side of the price bars `above` names; one over the candles carries no flag at all. */
function sideOfBars(indicator: SavedIndicator, above: boolean): SavedIndicator {
  return above ? withoutBelowBarsFlag(indicator) : { ...indicator, belowBars: true };
}

/** The entry without its `belowBars` key, so an indicator moved over the candles leaves no trace of the flag. */
function withoutBelowBarsFlag(indicator: SavedIndicator): SavedIndicator {
  const { belowBars: _belowBars, ...over } = indicator;
  return over;
}

/** The entry without its `hidden` key, so showing it again leaves no trace of the flag. */
function withoutHiddenFlag(indicator: SavedIndicator): SavedIndicator {
  const { hidden: _hidden, ...shown } = indicator;
  return shown;
}

/** The entry without its `paneHeight` key, so a height that no longer reads leaves no trace of the one it had. */
function withoutPaneHeight(indicator: SavedIndicator): SavedIndicator {
  const { paneHeight: _paneHeight, ...rest } = indicator;
  return rest;
}

/** The entry without its `timeframeVisibility` key, so a new visibility, or none of them, can be written. */
function withoutTimeframeVisibility(indicator: SavedIndicator): SavedIndicator {
  const { timeframeVisibility: _timeframeVisibility, ...rest } = indicator;
  return rest;
}
