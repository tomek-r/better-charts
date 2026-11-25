import type {
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
} from 'lightweight-charts';
import { VOLUME_FOOTPRINT_DEFAULT_OPTIONS, type VolumeFootprintOptions } from './volumeFootprintOptions';
import { VolumeFootprintRenderer } from './volumeFootprintRenderer';
import type { VolumeFootprintPoint } from './volumeFootprintPoint';

/** One chart's volume footprint bars as the library's custom series: its data, its options and its renderer. */
export class VolumeFootprintPaneView implements ICustomSeriesPaneView<
  Time,
  VolumeFootprintPoint,
  VolumeFootprintOptions
> {
  private readonly volumeFootprintRenderer = new VolumeFootprintRenderer();

  /** The prices the price scale fits to each bar: the candle's own low and high, which the columns never widen. */
  priceValueBuilder(point: VolumeFootprintPoint): number[] {
    return [point.low, point.high];
  }

  /** A bar whose close never arrived draws nothing, so the chart must not fit the scale to it. */
  isWhitespace(
    point: VolumeFootprintPoint | CustomSeriesWhitespaceData<Time>,
  ): point is CustomSeriesWhitespaceData<Time> {
    return !('close' in point);
  }

  renderer(): VolumeFootprintRenderer {
    return this.volumeFootprintRenderer;
  }

  update(data: PaneRendererCustomData<Time, VolumeFootprintPoint>, options: VolumeFootprintOptions): void {
    this.volumeFootprintRenderer.update(data, options);
  }

  defaultOptions(): VolumeFootprintOptions {
    return { ...VOLUME_FOOTPRINT_DEFAULT_OPTIONS };
  }
}
