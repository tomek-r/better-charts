import type { RenderBar } from '../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../chart/engine/indicators/indicatorContract';
import type { IndicatorBar, IndicatorFrame } from '../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { FormingBar } from './formingBar';
import { indicatorFrameBar } from './indicatorFrameBars';

/**
 * An indicator whose value per bar comes from the state the closed bars left behind.
 *
 * The state never takes in the bar the chart is still drawing, so a tick of that bar only redraws
 * it and never leaks into what the next bar starts from. A bar that closes is committed exactly
 * once, and a bar older than the forming one changes nothing and draws nothing, because the chart
 * has already moved past it.
 */
export abstract class BarByBarIndicator implements ChartIndicator {
  private readonly forming = new FormingBar();

  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    this.reset(settings);
    this.forming.reset();

    const formingIndex = bars.length - 1;
    const indicatorBars = bars.map((bar, index) => {
      if (index === formingIndex) {
        this.forming.adopt(bar);
        return this.formingBar(bar);
      }
      return this.confirmedBar(bar);
    });
    return { ...this.frameStyle(settings), bars: indicatorBars };
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const frame = this.frameStyle(settings);
    if (this.forming.isBehind(bar)) {
      return { ...frame, bars: [] };
    }
    const closedBar = this.forming.adopt(bar);
    const closedBars = closedBar === null ? [] : [this.confirmedBar(closedBar)];
    return { ...frame, bars: [...closedBars, this.formingBar(bar)] };
  }

  /** Starts the state over from the settings, as every load does. */
  protected abstract reset(settings: SettingValues): void;

  /** The values a bar plots, read from the state as of the last closed bar without moving it on. */
  protected abstract valuesAt(bar: RenderBar): readonly (number | null)[];

  /** Moves the state on to a bar that closed, so the state stays as of the newest closed bar. */
  protected abstract commit(bar: RenderBar): void;

  /** The parts of the frame the bars do not touch, which the settings alone decide. */
  protected abstract frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'>;

  /** Frames a bar that is final: its values are read before the bar moves the state on. */
  private confirmedBar(bar: RenderBar): IndicatorBar {
    const values = this.valuesAt(bar);
    this.commit(bar);
    return indicatorFrameBar(bar, values, true);
  }

  /** Frames the bar the chart is still drawing, which leaves the state alone. */
  private formingBar(bar: RenderBar): IndicatorBar {
    return indicatorFrameBar(bar, this.valuesAt(bar), false);
  }
}
