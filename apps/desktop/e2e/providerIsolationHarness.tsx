import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { AppHeaderView } from '../src/features/app-header/AppHeaderView';
import {
  PanelVisibilityProvider,
  usePanelActions,
  usePanelOpen,
} from '../src/features/app-header/PanelVisibilityProvider';
import {
  useBridgeAccount,
  useBridgeMarket,
  useBridgePortfolio,
  useBridgeSessionRuntime,
  BridgeSessionProvider,
  useTauriAvailable,
} from '../src/features/bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider, useChartResources } from '../src/features/chart/ChartWorkspaceProvider';
import { ExecutionProvider } from '../src/features/execution/ExecutionProvider';
import type { QuoteSnapshot } from '../src/shared/bridge/types';
import {
  OrderTicketProvider,
  useOrderTicketEditProps,
  useOrderTicketRuntime,
} from '../src/features/order-ticket/OrderTicketProvider';
import { SymbolSearchView } from '../src/features/symbol-search/SymbolSearchView';
import { SymbolSearchProvider } from '../src/features/symbol-search/SymbolSearchProvider';
import { AppSettingsProvider, useAppSettingsView } from '../src/features/settings/AppSettingsProvider';

interface ProviderHarnessWindow extends Window {
  __providerProbeCounts: Record<string, number>;
  __resetProviderProbeCounts: () => void;
}

const getHarnessWindow = () => window as unknown as ProviderHarnessWindow;

const recordRender: ProfilerOnRenderCallback = (id) => {
  const counts = getHarnessWindow().__providerProbeCounts;
  counts[id] = (counts[id] ?? 0) + 1;
};

function Probe({ children, id }: { children: ReactNode; id: string }) {
  return (
    <Profiler id={id} onRender={recordRender}>
      {children}
    </Profiler>
  );
}

function MarketProbe() {
  const { quote, snapshot } = useBridgeMarket();
  return <output data-testid="probe-market">{quote?.bid ?? snapshot.symbol}</output>;
}

function BridgeRuntimeProbe() {
  const session = useBridgeSessionRuntime();
  return <output data-testid="probe-bridge-runtime">{session.status.state}</output>;
}

function AccountProbe() {
  const account = useBridgeAccount();
  return <output data-testid="probe-account">{account?.balance ?? 'none'}</output>;
}

function PortfolioProbe() {
  const portfolio = useBridgePortfolio();
  return <output data-testid="probe-portfolio">{portfolio?.capturedAtMs ?? 'none'}</output>;
}

function SettingsProbe() {
  const settings = useAppSettingsView();
  return (
    <output data-testid="probe-settings">
      {settings.settings?.mt5BridgeSettings.address ?? 'loading'}|restart:{String(settings.restartNoticeVisible)}
    </output>
  );
}

function ChartResourcesProbe() {
  useChartResources();
  return <output data-testid="probe-chart-resources">resources</output>;
}

function TicketEditProbe() {
  const edit = useOrderTicketEditProps();
  return <output data-testid="probe-ticket-edit">{edit.pricing.entry}</output>;
}

function PanelProbe() {
  const panelOpen = usePanelOpen();
  return <output data-testid="probe-panel">{String(panelOpen)}</output>;
}

function BridgeControls() {
  const session = useBridgeSessionRuntime();
  const updateQuote = () => {
    const quote: QuoteSnapshot = {
      symbol: 'EURUSD',
      timeMs: 1745700001000,
      bid: '1.0852',
      ask: '1.0854',
      last: '1.0852',
      volume: 10,
      volumeReal: '0',
      flags: 0,
    };
    session.setQuote(quote);
  };
  return (
    <div data-testid="provider-probe-ready">
      <button type="button" onClick={updateQuote}>
        Update quote
      </button>
    </div>
  );
}

function TicketControls() {
  const ticket = useOrderTicketRuntime();
  return (
    <button type="button" onClick={() => ticket.setEntry('1.2345')}>
      Edit ticket
    </button>
  );
}

function PanelControls() {
  const { setPanelOpen } = usePanelActions();
  return (
    <button type="button" onClick={() => setPanelOpen((open) => !open)}>
      Toggle panel
    </button>
  );
}

function SettingsControls() {
  const settings = useAppSettingsView();
  const saveSettings = () => {
    if (settings.settings) {
      settings.saved({ ...settings.settings, restartRequired: true });
    }
  };
  return (
    <button type="button" onClick={saveSettings}>
      Save settings state
    </button>
  );
}

function HeaderProbes() {
  const tauriAvailable = useTauriAvailable();
  return (
    <AppSettingsProvider tauriAvailable={tauriAvailable}>
      <Probe id="header">
        <AppHeaderView />
      </Probe>
      <Probe id="settings">
        <SettingsProbe />
      </Probe>
      <SettingsControls />
    </AppSettingsProvider>
  );
}

function WorkspaceProbes() {
  return (
    <ChartWorkspaceProvider>
      <BridgeSessionProvider>
        <SymbolSearchProvider>
          <HeaderProbes />
          <SymbolSearchView />
        </SymbolSearchProvider>
        <Probe id="bridge-runtime">
          <BridgeRuntimeProbe />
        </Probe>
        <Probe id="market">
          <MarketProbe />
        </Probe>
        <Probe id="account">
          <AccountProbe />
        </Probe>
        <Probe id="portfolio">
          <PortfolioProbe />
        </Probe>
        <Probe id="chart-resources">
          <ChartResourcesProbe />
        </Probe>
        <ExecutionProvider>
          <OrderTicketProvider>
            <Probe id="ticket-edit">
              <TicketEditProbe />
            </Probe>
            <TicketControls />
          </OrderTicketProvider>
        </ExecutionProvider>
        <Probe id="panel">
          <PanelProbe />
        </Probe>
        <PanelControls />
        <BridgeControls />
      </BridgeSessionProvider>
    </ChartWorkspaceProvider>
  );
}

export function mountProviderIsolationHarness(container: HTMLElement): void {
  const target = getHarnessWindow();
  target.__providerProbeCounts = {};
  target.__resetProviderProbeCounts = () => {
    target.__providerProbeCounts = {};
  };

  createRoot(container).render(
    <PanelVisibilityProvider>
      <WorkspaceProbes />
    </PanelVisibilityProvider>,
  );
}
