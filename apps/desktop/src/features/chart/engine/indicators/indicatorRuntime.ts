/**
 * The indicators attached to one chart: the engine feeds them every bar they need and
 * never imports a concrete indicator or the registry they are registered in.
 */
import type { ISeriesApi } from 'lightweight-charts';
import type { RenderBar } from '../bars/renderBar';
import type { SettingValues } from '../settings/settingInputs';
import { resolveSettingValues } from '../settings/settingsSchema';
import type { ChartIndicator, ChartIndicatorDefinition, ChartIndicatorOutlet } from './indicatorContract';
import { indicatorDisplayOf, indicatorSettingsSchema } from './indicatorDisplaySettings';
import type { IndicatorFrame } from './indicatorFrame';
import type { IndicatorLayer } from './indicatorLayer';

export interface AttachedIndicatorState {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly settings: SettingValues;
  readonly hidden: boolean;
}

interface AttachedIndicator {
  readonly definition: ChartIndicatorDefinition;
  readonly indicator: ChartIndicator;
  /** The height of its own pane relative to the price pane, as it was saved; undefined until the user resized it. */
  readonly paneHeight: number | undefined;
  settings: SettingValues;
  hidden: boolean;
}

export class IndicatorRuntime {
  private readonly attached = new Map<string, AttachedIndicator>();

  constructor(
    private readonly layer: IndicatorLayer,
    private readonly definitions: readonly ChartIndicatorDefinition[],
    private readonly bars: () => readonly RenderBar[],
    /** Called after the attached indicators or the values they draw changed, so the legend follows. */
    private readonly changed: () => void,
    private readonly priceSeries: ISeriesApi<'Candlestick'>,
  ) {}

  /**
   * Attaches `definitionId` as `instanceId`, replacing one already attached; false when unknown. `paneHeight`
   * is the height its own pane was saved with, relative to the price pane, and is left out while it has none.
   */
  attach(instanceId: string, definitionId: string, stored: unknown, paneHeight?: number): boolean {
    const definition = this.definitions.find((candidate) => candidate.id === definitionId);
    if (!definition) {
      return false;
    }
    // A replaced indicator is disposed like a detached one, so it releases what it holds.
    this.detach(instanceId);
    const entry: AttachedIndicator = {
      definition,
      indicator: new definition.indicatorClass(),
      paneHeight,
      settings: resolveSettingValues(indicatorSettingsSchema(definition), stored),
      hidden: false,
    };
    this.attached.set(instanceId, entry);
    entry.indicator.connect?.(this.outletOf(instanceId, entry));
    this.reload(instanceId, entry);
    this.changed();
    return true;
  }

  /** Detaches the indicator `instanceId`; an unknown id does nothing. */
  detach(instanceId: string): void {
    const entry = this.attached.get(instanceId);
    if (!entry) {
      return;
    }
    entry.indicator.dispose?.();
    this.layer.remove(instanceId);
    this.attached.delete(instanceId);
    this.changed();
  }

  /** Resolves `stored` again and reloads `instanceId`; an unknown id does nothing. */
  setSettings(instanceId: string, stored: unknown): void {
    const entry = this.attached.get(instanceId);
    if (!entry) {
      return;
    }
    entry.settings = resolveSettingValues(indicatorSettingsSchema(entry.definition), stored);
    this.reload(instanceId, entry);
    this.changed();
  }

  /** Hides or shows `instanceId` without reloading it; an unknown id or an unchanged state does nothing. */
  setHidden(instanceId: string, hidden: boolean): void {
    const entry = this.attached.get(instanceId);
    if (!entry || entry.hidden === hidden) {
      return;
    }
    entry.hidden = hidden;
    entry.indicator.setHidden?.(hidden);
    this.layer.setHidden(instanceId, hidden);
    this.changed();
  }

  /** Loads every attached indicator again after a new history, symbol, timeframe or older page. */
  historyChanged(): void {
    for (const [instanceId, entry] of this.attached) {
      this.reload(instanceId, entry);
    }
    this.changed();
  }

  /** Hands the live bar to every attached indicator, each of which keeps its own state. */
  barChanged(bar: RenderBar): void {
    for (const [instanceId, entry] of this.attached) {
      this.layer.update(instanceId, entry.indicator.update(bar, entry.settings));
    }
    this.changed();
  }

  /** The newest bar changed or a new one opened: hands that bar to every attached indicator. */
  liveBarChanged(): void {
    const bar = this.bars().at(-1);
    if (!bar) {
      return;
    }
    this.barChanged(bar);
  }

  /** An older page widened the history: every attached indicator loads again; returns `added`. */
  olderBarsAdded(added: number): number {
    if (added > 0) {
      this.historyChanged();
    }
    return added;
  }

  /** Every attached indicator in attach order, with its resolved settings, as plain copies. */
  attachedState(): AttachedIndicatorState[] {
    return [...this.attached].map(([instanceId, entry]) => ({
      instanceId,
      definitionId: entry.definition.id,
      settings: { ...entry.settings },
      hidden: entry.hidden,
    }));
  }

  /** Detaches every attached indicator. */
  destroy(): void {
    for (const instanceId of [...this.attached.keys()]) {
      this.detach(instanceId);
    }
  }

  /** What `instanceId` pushes frames through; it stops drawing once this entry is detached or replaced. */
  private outletOf(instanceId: string, entry: AttachedIndicator): ChartIndicatorOutlet {
    return {
      showFrame: (frame) => {
        this.drawWhileAttached(instanceId, entry, () => this.showFrameOf(instanceId, entry, frame));
      },
      updateFrame: (frame) => {
        this.drawWhileAttached(instanceId, entry, () => this.layer.update(instanceId, frame));
      },
      priceSeries: this.priceSeries,
    };
  }

  /** Draws a frame an indicator handed over, unless that indicator has been detached or replaced. */
  private drawWhileAttached(instanceId: string, entry: AttachedIndicator, draw: () => void): void {
    if (this.attached.get(instanceId) !== entry) {
      return;
    }
    draw();
    this.changed();
  }

  /** Loads the whole history into `instanceId` and draws the frame that comes back, in the indicator's pane. */
  private reload(instanceId: string, entry: AttachedIndicator): void {
    this.showFrameOf(instanceId, entry, entry.indicator.load(this.bars(), entry.settings));
  }

  /** Draws a whole frame in the indicator's pane. */
  private showFrameOf(instanceId: string, entry: AttachedIndicator, frame: IndicatorFrame): void {
    this.layer.show(instanceId, frame, entry.definition.pane, {
      priceLabelsVisible: indicatorDisplayOf(entry.settings).labelsOnPriceScale,
      paneHeight: entry.paneHeight,
    });
    if (entry.hidden) {
      // A new frame is drawn visible, so a hidden indicator has to be hidden again after every reload.
      this.layer.setHidden(instanceId, true);
    }
  }
}
