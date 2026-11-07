import type { ISeriesApi } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import type { SettingInputDefinition, SettingValues } from '../settings/settingInputs';
import type { SettingStyleDefinition } from '../settings/settingStyles';
import type { IndicatorFrame } from './indicatorFrame';

/** The pane an indicator's plots are drawn in: over the price pane, or in one of its own. */
export type ChartIndicatorPane = 'overlay' | 'own';

/** Where an indicator whose frames arrive later hands them; a frame from a detached indicator is dropped. */
export interface ChartIndicatorOutlet {
  /** Draws a whole frame, as a `load` result is drawn. */
  showFrame(frame: IndicatorFrame): void;
  /** Applies a live frame, as an `update` result is applied. */
  updateFrame(frame: IndicatorFrame): void;
  /** The chart's price series, for an indicator that draws what a frame cannot describe. */
  readonly priceSeries: ISeriesApi<'Candlestick'>;
}

/**
 * An indicator attached to a chart, as the engine drives it: bars in, a frame out, nothing else.
 *
 * An indicator reads nothing but what it is given — no Tauri, no stores — and every number it
 * returns is display-only, never an order input.
 */
export interface ChartIndicator {
  /**
   * Every bar, after a history, a settings or a symbol/timeframe change: rebuilds the indicator's state
   * up to the newest bar, which is the one still forming, and returns the whole frame.
   */
  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame;
  /**
   * One live bar: the forming bar again (same time: a tick) or a newer one (the forming bar closed).
   * Returns only the bars that changed: the closed bar, if any, then the forming one; a bar older than
   * the forming one changes nothing. The state stays as of the last closed bar, so a tick never leaks
   * into it; a settings change arrives as `load`.
   */
  update(bar: RenderBar, settings: SettingValues): IndicatorFrame;
  dispose?(): void;
  /** Called once before the first `load`, for an indicator that also pushes frames. */
  connect?(outlet: ChartIndicatorOutlet): void;
  /** Told when the user hides or shows it, for an indicator that draws outside its frames. */
  setHidden?(hidden: boolean): void;
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
