import type { ChartTypeAppearance } from '../engine/barStyle/chartTypeAppearance';
import type { ChartTypeSpec } from './chartTypeCommands';

/** How many fraction digits a setting's text may carry, which is every digit a double holds exactly. */
const DECIMAL_DIGITS = 20;

/**
 * A setting's number as the decimal text the command parses. The locale is pinned and the fraction digits are
 * spelled out, because the exponent form a plain number can take is not a decimal the command reads.
 */
export function decimalSetting(value: number): string {
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: DECIMAL_DIGITS });
}

/**
 * The spec `compute_chart_type_bars` reads for the chart type on screen, one shape per chart kind. The counts it
 * reads as whole numbers are rounded, so a stray fraction in a setting never fails the call.
 */
export function chartTypeSpecOf(appearance: ChartTypeAppearance): ChartTypeSpec {
  switch (appearance.style) {
    case 'renko':
      return {
        type: 'renko',
        boxMethod: appearance.boxMethod,
        atrLength: Math.round(appearance.atrLength),
        boxSize: decimalSetting(appearance.boxSize),
        percentage: decimalSetting(appearance.percentage),
        wicks: appearance.wicks,
      };
    case 'lineBreak':
      return { type: 'lineBreak', lines: Math.round(appearance.lines) };
    case 'kagi':
      return {
        type: 'kagi',
        reversalMethod: appearance.reversalMethod,
        atrLength: Math.round(appearance.atrLength),
        reversal: decimalSetting(appearance.reversal),
        percentage: decimalSetting(appearance.percentage),
      };
  }
}
