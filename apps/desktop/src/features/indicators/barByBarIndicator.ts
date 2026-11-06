import type { RenderBar } from '../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../chart/engine/indicators/indicatorContract';
import type { IndicatorBar, IndicatorFrame } from '../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { FormingBar } from './formingBar';
import { indicatorFrameBar } from './indicatorFrameBars';

/** The parts of a frame the settings alone decide, which one tick never changes. */
type FrameStyle = Omit<IndicatorFrame, 'bars'>;

/** What a tick draws before any load has read the settings: the frame has no plot, and so draws no bar. */
const NO_STYLE: FrameStyle = { plots: [] };

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
  private style: FrameStyle = NO_STYLE;

  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    this.reset(settings);
    this.forming.reset();
    this.style = this.frameStyle(settings);

    const formingIndex = bars.length - 1;
    const indicatorBars = bars.map((bar, index) => {
      if (index === formingIndex) {
        this.forming.adopt(bar);
        return this.formingBar(bar);
      }
      return this.confirmedBar(bar);
    });
    return { ...this.style, bars: indicatorBars };
  }

  /**
   * Redraws the bars a tick changes from the style the load built: the settings alone decide that
   * style, and a caller that changes them shows the whole frame again.
   */
  update(bar: RenderBar, _settings: SettingValues): IndicatorFrame {
    if (this.forming.isBehind(bar)) {
      return { ...this.style, bars: [] };
    }
    const closedBar = this.forming.adopt(bar);
    const closedBars = closedBar === null ? [] : [this.confirmedBar(closedBar)];
    return { ...this.style, bars: [...closedBars, this.formingBar(bar)] };
  }

  /** Starts the state over from the settings, as every load does. */
  protected abstract reset(settings: SettingValues): void;

  /** The values a bar plots, read from the state as of the last closed bar without moving it on. */
  protected abstract valuesAt(bar: RenderBar): readonly (number | null)[];

  /** The per-plot colours of a bar, read from the same state as `valuesAt`, if it colours anything. */
  protected colorsAt(_bar: RenderBar): readonly (string | null)[] | undefined {
    return undefined;
  }

  /** Moves the state on to a bar that closed, so the state stays as of the newest closed bar. */
  protected abstract commit(bar: RenderBar): void;

  /** The parts of the frame the bars do not touch, which the settings alone decide. */
  protected abstract frameStyle(settings: SettingValues): FrameStyle;

  /** Frames a bar that is final: its values and colours are read before the bar moves the state on. */
  private confirmedBar(bar: RenderBar): IndicatorBar {
    const values = this.valuesAt(bar);
    const colors = this.colorsAt(bar);
    this.commit(bar);
    return indicatorFrameBar(bar, values, true, colors);
  }

  /** Frames the bar the chart is still drawing, which leaves the state alone. */
  private formingBar(bar: RenderBar): IndicatorBar {
    return indicatorFrameBar(bar, this.valuesAt(bar), false, this.colorsAt(bar));
  }
}
