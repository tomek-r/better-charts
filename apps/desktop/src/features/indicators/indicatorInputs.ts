import type {
  SettingInputInt,
  SettingInputSource,
  SettingInputSourceChoice,
} from '../chart/engine/settings/settingInputs';
import type { SettingStyleLine, SettingStyleLineStyle } from '../chart/engine/settings/settingStyles';

/** The stored id of the input naming how many source values a window spans. */
export const LENGTH_INPUT = 'length';
/** The stored id of the input naming which price series a window reads. */
export const SOURCE_INPUT = 'source';

const LENGTH_MIN = 1;
const LENGTH_MAX = 5000;
const LENGTH_STEP = 1;
const LENGTH_TITLE = 'Length';
const LINE_WIDTH = 1;
const LINE_DASH: SettingStyleLineStyle = 'solid';

/**
 * The `int` input a window indicator asks for its length, starting at `defaultValue` and storing the
 * shared `length` key unless `options` names another id, title or upper bound.
 */
export function lengthInput(
  defaultValue: number,
  options: { id?: string; title?: string; maxValue?: number } = {},
): SettingInputInt {
  return {
    kind: 'int',
    id: options.id ?? LENGTH_INPUT,
    title: options.title ?? LENGTH_TITLE,
    defaultValue,
    minValue: LENGTH_MIN,
    maxValue: options.maxValue ?? LENGTH_MAX,
    step: LENGTH_STEP,
  };
}

/** The `source` input a window indicator asks for its price series, starting at `defaultValue`. */
export function sourceInput(defaultValue: SettingInputSource): SettingInputSourceChoice {
  return { kind: 'source', id: SOURCE_INPUT, title: 'Source', defaultValue };
}

/** A drawn `line` style with the shared width, coloured `color` and dashed `dash` unless overridden. */
export function lineStyle(
  id: string,
  title: string,
  color: string,
  dash: SettingStyleLineStyle = LINE_DASH,
): SettingStyleLine {
  return { kind: 'line', id, title, defaults: { visible: true, color, width: LINE_WIDTH, style: dash } };
}
