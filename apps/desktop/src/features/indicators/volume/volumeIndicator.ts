import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../../chart/engine/settings/settingStyles';
import { BarByBarIndicator } from '../barByBarIndicator';
import { booleanSetting, colorSetting, linePlotSetting, numberSetting, stringSetting } from '../indicatorSettingValues';
import { plotDrawingOf } from '../plotTypes';
import { SMA_TYPE, volumeAverageOf, type VolumeAverage } from './volumeAverage';

export const VOLUME_STYLE = 'volume';
export const GROWING_STYLE = 'volumeGrowing';
export const FALLING_STYLE = 'volumeFalling';
export const MA_TYPE_INPUT = 'maType';
export const MA_LENGTH_INPUT = 'maLength';
export const MA_STYLE = 'volumeMa';
export const PLOT_TYPE_STYLE = 'volumePlotType';
export const PRICE_LINE_STYLE = 'volumePriceLine';
export const DEFAULT_GROWING_COLOR = '#08998180';
export const DEFAULT_FALLING_COLOR = '#F2364580';
export const DEFAULT_MA_TYPE = SMA_TYPE;
export const DEFAULT_MA_LENGTH = 20;
export const DEFAULT_MA_COLOR = '#2196F3';

/** The Plot type Volume starts with, and the one an unrecognised stored value reads as. */
export const DEFAULT_PLOT_TYPE = 'columns';

const VOLUME_TITLE = 'Volume';
const MA_TITLE = 'Volume MA';
const DEFAULT_VOLUME_VISIBLE = true;
const DEFAULT_MA_VISIBLE = false;
const VOLUME_WIDTH = 1;
const MA_WIDTH = 1;
const VOLUME_PRECISION = 0;

/** The volume plot, drawn the chosen way, in the Growing colour and switched off by the Volume toggle. */
function volumePlot(settings: SettingValues, growingColor: string): IndicatorPlot {
  return {
    title: VOLUME_TITLE,
    ...plotDrawingOf(settings, PLOT_TYPE_STYLE, PRICE_LINE_STYLE, DEFAULT_PLOT_TYPE),
    color: growingColor,
    lineWidth: VOLUME_WIDTH,
    visible: booleanSetting(settings, settingStyleKey(VOLUME_STYLE, 'visible'), DEFAULT_VOLUME_VISIBLE),
  };
}

/** The MA line, switched off by the Volume MA toggle. */
function averagePlot(settings: SettingValues): IndicatorPlot {
  return linePlotSetting(settings, MA_STYLE, { title: MA_TITLE, color: DEFAULT_MA_COLOR, width: MA_WIDTH });
}

/**
 * The bar's tick volume as one plot per bar, drawn as the chosen Plot type and coloured by whether
 * the bar closed at or above its open, with an optional moving average line of the volumes.
 * `frameStyle` reads the colours `reset` stored, and `reset` runs before every frame the bar walk
 * builds, so the fields are set by then.
 */
export class VolumeIndicator extends BarByBarIndicator {
  private growingColor = DEFAULT_GROWING_COLOR;
  private fallingColor = DEFAULT_FALLING_COLOR;
  private average: VolumeAverage = volumeAverageOf(DEFAULT_MA_TYPE, DEFAULT_MA_LENGTH);
  private averageVisible = DEFAULT_MA_VISIBLE;

  protected reset(settings: SettingValues): void {
    this.growingColor = colorSetting(settings, GROWING_STYLE, DEFAULT_GROWING_COLOR);
    this.fallingColor = colorSetting(settings, FALLING_STYLE, DEFAULT_FALLING_COLOR);
    const length = numberSetting(settings, MA_LENGTH_INPUT, DEFAULT_MA_LENGTH);
    this.average = volumeAverageOf(stringSetting(settings, MA_TYPE_INPUT, DEFAULT_MA_TYPE), length);
    this.averageVisible = booleanSetting(settings, settingStyleKey(MA_STYLE, 'visible'), DEFAULT_MA_VISIBLE);
  }

  /** A bar's own volume: a bar that traded nothing plots 0 rather than a gap, plus the MA while it is on. */
  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    if (!this.averageVisible) {
      return [bar.volume];
    }
    return [bar.volume, this.average.valueWith(bar.volume)];
  }

  /** A bar closing at or above its open grows, the rest fall; the MA line has no per-point colour. */
  protected colorsAt(bar: RenderBar): readonly (string | null)[] {
    const columnColor = bar.close >= bar.open ? this.growingColor : this.fallingColor;
    if (!this.averageVisible) {
      return [columnColor];
    }
    return [columnColor, null];
  }

  /** The average moves on a closed bar only, so a moving tick never changes the line. */
  protected commit(bar: RenderBar): void {
    this.average.commit(bar.volume);
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    const volume = volumePlot(settings, this.growingColor);
    if (!this.averageVisible) {
      return { plots: [volume], precision: VOLUME_PRECISION };
    }
    return { plots: [volume, averagePlot(settings)], precision: VOLUME_PRECISION };
  }
}
