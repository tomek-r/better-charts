import type { RenderBar } from '../bars/renderBar';
import type { SettingInputDefinition, SettingValues } from '../settings/settingInputs';
import type { SettingStyleDefinition } from '../settings/settingStyles';
import type { IndicatorFrame } from './indicatorFrame';

/** The pane an indicator's plots are drawn in: over the price pane, or in one of its own. */
export type ChartIndicatorPane = 'overlay' | 'own';

/**
 * An indicator attached to a chart, as the engine drives it: bars in, a frame out, nothing else.
 *
 * An indicator reads nothing but what it is given — no Tauri, no stores — and every number it
 * returns is display-only, never an order input.
 */
export interface ChartIndicator {
  /** Every bar, after a history, a settings or a symbol/timeframe change. */
  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame;
  /**
   * The newest bar changed or a new one opened. The frame carries only the closed bar, if any,
   * then the forming one.
   */
  update(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame;
  dispose?(): void;
  /** Development builds only: a read-only view of the indicator's state for the e2e suite. */
  testApi?(): unknown;
}

/**
 * What the engine needs to know about an indicator: its behavior, nothing about how the app
 * presents it. The app's list metadata lives in `features/indicators`.
 */
export interface ChartIndicatorDefinition {
  readonly id: string;
  readonly pane: ChartIndicatorPane;
  /** The settings the indicator offers, in the setting input kinds; omitted means none. */
  readonly inputs?: readonly SettingInputDefinition[];
  /** The per-plot style settings, stored beside the inputs; omitted means none. */
  readonly styles?: readonly SettingStyleDefinition[];
  /** The engine builds one instance per attached indicator with `new indicatorClass()`. */
  readonly indicatorClass: new () => ChartIndicator;
}
