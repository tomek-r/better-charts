import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRequiredContext } from '../../../shared/context/useRequiredContext';
import { errorText } from '../../../shared/errorText';
import { useNotifyError } from '../../../shared/ui/notification/ErrorNotifications';
import { useBridgeConnectionSelector } from '../../bridge/bridgeSelectors';
import { useChartResources } from '../ChartWorkspaceProvider';
import { chartScopeKey, useChartScope } from '../useChartScope';
import {
  chartSettingsOverrides,
  DEFAULT_CHART_SETTINGS,
  resolveChartSettings,
  withTimeZone,
  type ChartSettings,
} from './chartSettings';
import { createTauriChartSettingsStore, type ChartSettingsStore, type StoredChartSettings } from './chartSettingsStore';

/** What the settings of the chart on screen offer: what it shows, and the ways to change it. */
export interface ChartSettingsChoice {
  /** The settings the chart shows now, the settings dialog's preview included. */
  readonly settings: ChartSettings;
  /** The template the chart starts from, so the dialog can show what this chart overrides. */
  readonly templateSettings: ChartSettings;
  /** Shows `next` without saving it, so the chart follows the dialog. */
  preview(next: ChartSettings): void;
  /** Shows `next` and stores it as this chart's overrides for the account and symbol on screen. */
  keep(next: ChartSettings): void;
  /** Drops the preview and shows the settings the chart kept. */
  revert(): void;
  /** Keeps the chart in `zone` by storing it among this chart's overrides. */
  selectTimeZone(zone: string): void;
}

/** Which chart the app draws, held apart from its settings so naming it costs no re-render. */
interface ChartIdentity {
  readonly chartId: string | undefined;
}

/** The settings the chart holds for the scope on screen, and the preview the dialog is trying. */
interface SettingsState {
  /** The scope the settings were loaded for; undefined while the chart had none to load. */
  readonly scopeKey: string | undefined;
  readonly template: ChartSettings;
  readonly kept: ChartSettings;
  readonly preview: ChartSettings | undefined;
  /** Whether the user already chose settings for this scope, which a late load must not overwrite. */
  readonly chosenByUser: boolean;
}

const ChartIdentityContext = createContext<ChartIdentity | null>(null);
const ChartSettingsContext = createContext<ChartSettingsChoice | null>(null);

/** The state one scope's settings start as: its template, and the kept settings it resolves to. */
function settingsState(scopeKey: string | undefined, stored: StoredChartSettings | undefined): SettingsState {
  const template = stored === undefined ? resolveChartSettings([]) : resolveChartSettings([stored.template]);
  const kept = stored === undefined ? template : resolveChartSettings([stored.template, stored.overrides]);
  return { scopeKey, template, kept, preview: undefined, chosenByUser: false };
}

/** The state a load answers with, unless the user already chose settings for this same scope. */
function loadedSettings(
  current: SettingsState | undefined,
  scopeKey: string | undefined,
  stored: StoredChartSettings | undefined,
): SettingsState {
  if (current !== undefined && current.chosenByUser && current.scopeKey === scopeKey) {
    return current;
  }
  return settingsState(scopeKey, stored);
}

/** The state of the scope on screen: the one loaded for it, or the defaults while it has none. */
function scopeSettings(current: SettingsState | undefined, scopeKey: string | undefined): SettingsState {
  if (current !== undefined && current.scopeKey === scopeKey) {
    return current;
  }
  return settingsState(scopeKey, undefined);
}

/** The saved chart whose id the app draws, read once per provider. */
function useStoredChartId(store: ChartSettingsStore): string | undefined {
  const notifyError = useNotifyError();
  const [chartId, setChartId] = useState<string | undefined>(undefined);

  // One chart per window: the first of the layout, which the store guarantees is there. A layout
  // that cannot be read leaves the id unknown, so no chart state is saved under an invented chart.
  useEffect(() => {
    let layoutRead = false;
    store
      .loadLayout()
      .then((layout) => {
        if (!layoutRead) {
          setChartId(layout[0].chartId);
        }
      })
      .catch((error: unknown) => {
        if (!layoutRead) {
          notifyError(errorText(error));
        }
      });
    return () => {
      layoutRead = true;
    };
  }, [notifyError, store]);

  return chartId;
}

/** The settings of the scope the chart shows, kept for the account and symbol they were chosen on. */
function useChartSettingsChoice(store: ChartSettingsStore): ChartSettingsChoice {
  const { chart } = useChartResources();
  const brokerUtcOffsetMinutes = useBridgeConnectionSelector(({ status }) => status.brokerUtcOffsetMinutes) ?? null;
  const scope = useChartScope();
  const scopeKey = chartScopeKey(scope);
  const notifyError = useNotifyError();
  const [state, setState] = useState<SettingsState | undefined>(undefined);

  // The chart opens on the settings of the account and symbol on screen. A load the backend
  // refuses is reported, and the chart falls back to its template defaults rather than to settings
  // of a scope it could not read.
  useEffect(() => {
    if (!scope) {
      return;
    }
    let scopeChanged = false;
    store
      .load(scope)
      .then((stored) => {
        // A load that lands after the scope moved on belongs to another window.
        if (scopeChanged) {
          return;
        }
        setState((current) => loadedSettings(current, scopeKey, stored));
      })
      .catch((error: unknown) => {
        if (scopeChanged) {
          return;
        }
        notifyError(errorText(error));
        setState((current) => loadedSettings(current, scopeKey, undefined));
      });
    return () => {
      scopeChanged = true;
    };
  }, [notifyError, scope, scopeKey, store]);

  const loaded = state !== undefined && state.scopeKey === scopeKey ? state : undefined;
  const kept = loaded?.kept ?? DEFAULT_CHART_SETTINGS;
  const settings = loaded?.preview ?? kept;
  const templateSettings = loaded?.template ?? DEFAULT_CHART_SETTINGS;

  const preview = useCallback(
    (next: ChartSettings) => {
      setState((current) => ({ ...scopeSettings(current, scopeKey), preview: next, chosenByUser: true }));
    },
    [scopeKey],
  );

  // The choice reaches the chart first, so a store that refuses the save costs the user nothing but
  // the notice: what the chart shows stays what was chosen.
  const keep = useCallback(
    (next: ChartSettings) => {
      setState((current) => ({
        ...scopeSettings(current, scopeKey),
        kept: next,
        preview: undefined,
        chosenByUser: true,
      }));
      if (!scope) {
        return;
      }
      store
        .saveOverrides(scope, chartSettingsOverrides(templateSettings, next))
        .catch((error: unknown) => notifyError(errorText(error)));
    },
    [notifyError, scope, scopeKey, store, templateSettings],
  );

  const revert = useCallback(() => {
    setState((current) => (current === undefined ? current : { ...current, preview: undefined }));
  }, []);

  const selectTimeZone = useCallback((zone: string) => keep(withTimeZone(kept, zone)), [keep, kept]);

  const choice = useMemo<ChartSettingsChoice>(
    () => ({ settings, templateSettings, preview, keep, revert, selectTimeZone }),
    [keep, preview, revert, selectTimeZone, settings, templateSettings],
  );

  // The engine formats its axis and readout in the chart's zone; the bars themselves never move.
  useEffect(() => {
    chart.current?.setTimeZone(settings.timeZone, brokerUtcOffsetMinutes);
  }, [brokerUtcOffsetMinutes, chart, settings.timeZone]);

  return choice;
}

/** The settings of the chart named above, for every component that draws with them. */
function ChartSettingsScope({ store, children }: { store: ChartSettingsStore; children: ReactNode }) {
  const choice = useChartSettingsChoice(store);
  return <ChartSettingsContext value={choice}>{children}</ChartSettingsContext>;
}

/**
 * The chart the app draws and the settings it is drawn with: the template of its first saved chart,
 * and the overrides of the account and symbol it shows. Every chart component below reads them, so
 * a zone or a bar style chosen once is the one the whole chart draws with.
 */
export function ChartSettingsProvider({ children }: { children: ReactNode }) {
  // One store for the lifetime of the chart, so every load and save here reaches the same backend.
  const [store] = useState<ChartSettingsStore>(createTauriChartSettingsStore);
  const chartId = useStoredChartId(store);
  const identity = useMemo<ChartIdentity>(() => ({ chartId }), [chartId]);
  return (
    <ChartIdentityContext value={identity}>
      <ChartSettingsScope store={store}>{children}</ChartSettingsScope>
    </ChartIdentityContext>
  );
}

/** The id of the chart on screen, undefined until the saved layout could be read. */
export function useChartId(): string | undefined {
  return useRequiredContext(ChartIdentityContext, 'useChartId must be used inside ChartSettingsProvider.').chartId;
}

/** The settings of the chart on screen, with the actions the settings dialog and pickers use. */
export function useChartSettings(): ChartSettingsChoice {
  return useRequiredContext(ChartSettingsContext, 'useChartSettings must be used inside ChartSettingsProvider.');
}
