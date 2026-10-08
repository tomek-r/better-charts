import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorNotificationsProvider } from '../src/shared/ui/ErrorNotifications';
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
  useBridgeQuote,
  useBridgePortfolio,
  useBridgeSessionRuntime,
  BridgeSessionProvider,
  useTauriAvailable,
} from '../src/features/bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider, useChartResources } from '../src/features/chart/ChartWorkspaceProvider';
import { ChartTitle } from '../src/features/chart/ChartTitle';
import { ChartQuotes } from '../src/features/chart/ChartQuotes';
import { ChartCanvas } from '../src/features/chart/ChartCanvas';
import { ChartTimeframes } from '../src/features/chart/ChartTimeframes';
import { ExecutionProvider } from '../src/features/execution/ExecutionProvider';
import type { AccountSnapshot, BrokerSymbol, QuoteSnapshot } from '../src/shared/bridge/types';
import { OrderTicketProvider } from '../src/features/order-ticket/OrderTicketProvider';
import { useOrderTicketAction } from '../src/features/order-ticket/editor/useOrderTicketAction';
import { useOrderTicketHeader } from '../src/features/order-ticket/editor/useOrderTicketHeader';
import { useOrderTicketPricing } from '../src/features/order-ticket/editor/useOrderTicketPricing';
import { useOrderTicketRuntime } from '../src/features/order-ticket/state/useOrderTicketRuntime';
import { OrderTicketTickValue } from '../src/features/order-ticket/editor/OrderTicketTickValue';
import { OrderTicketSizing } from '../src/features/order-ticket/editor/OrderTicketSizing';
import { OrderTicketExits } from '../src/features/order-ticket/editor/OrderTicketExits';
import { OrderTicketReviewAction } from '../src/features/order-ticket/editor/OrderTicketReviewAction';
import { OrderTicketQuotes } from '../src/features/order-ticket/editor/OrderTicketQuotes';
import { OrderTicketExtraSettings } from '../src/features/order-ticket/editor/OrderTicketExtraSettings';
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
  const { snapshot, latestCandle } = useBridgeMarket();
  const quote = useBridgeQuote();
  return (
    <>
      <output data-testid="probe-market">{quote?.bid ?? snapshot.symbol}</output>
      <output data-testid="probe-candle-close">{latestCandle?.close ?? snapshot.candles[0]?.close}</output>
    </>
  );
}

function ChartHeaderProbes() {
  return (
    <div data-testid="probe-chart-header">
      <Probe id="chart-title">
        <ChartTitle />
      </Probe>
      <Probe id="chart-quotes">
        <ChartQuotes />
      </Probe>
      <Probe id="chart-timeframes">
        <ChartTimeframes />
      </Probe>
      <Probe id="chart-canvas">
        <ChartCanvas />
      </Probe>
    </div>
  );
}

function BridgeRuntimeProbe() {
  const session = useBridgeSessionRuntime();
  return (
    <output data-testid="probe-bridge-runtime">
      {[
        session.status.state,
        String(session.tauriAvailable),
        session.snapshot.symbol ?? '',
        session.latestCandle?.close ?? '',
        session.quote?.bid ?? '',
        session.account?.balance ?? '',
        String(session.portfolio?.capturedAtMs ?? ''),
      ].join('|')}
    </output>
  );
}

function AccountProbe() {
  const account = useBridgeAccount();
  return <output data-testid="probe-account">{account?.balance ?? 'none'}</output>;
}

function PortfolioProbe() {
  const portfolio = useBridgePortfolio();
  return <output data-testid="probe-portfolio">{portfolio?.capturedAtMs ?? 'none'}</output>;
}

function SecondaryBridgeProbes() {
  const quote = useBridgeQuote();
  const account = useBridgeAccount();
  const portfolio = useBridgePortfolio();
  const market = useBridgeMarket();
  return (
    <div data-testid="secondary-bridge-probes">
      <output data-testid="secondary-quote">{quote?.bid ?? 'none'}</output>
      <output data-testid="secondary-account">{account?.balance ?? 'none'}</output>
      <output data-testid="secondary-portfolio">{portfolio?.capturedAtMs ?? 'none'}</output>
      <output data-testid="secondary-market">{market.snapshot.symbol ?? 'none'}</output>
    </div>
  );
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
  const pricing = useOrderTicketPricing();
  return <output data-testid="probe-ticket-edit">{pricing.entry}</output>;
}

function PanelProbe() {
  const panelOpen = usePanelOpen();
  return <output data-testid="probe-panel">{String(panelOpen)}</output>;
}

function TicketHeaderProbe() {
  const { environment, symbol } = useOrderTicketHeader();
  return (
    <output data-testid="probe-ticket-header">
      {symbol ?? '—'}|{environment?.label ?? 'none'}
    </output>
  );
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
  const moveQuote = () => {
    session.setQuote((quote) =>
      quote
        ? { ...quote, bid: (Number(quote.bid) + 0.0001).toFixed(5), ask: (Number(quote.ask) + 0.0001).toFixed(5) }
        : quote,
    );
  };
  const setAccount = (next: Partial<AccountSnapshot> = {}) => {
    session.setAccount({
      accountLogin: '001234',
      brokerServer: 'Broker-Demo',
      currency: 'USD',
      currencyDigits: 2,
      balance: '1000.00',
      equity: '1000.00',
      margin: '0.00',
      freeMargin: '1000.00',
      marginLevel: '0',
      leverage: 100,
      marginMode: 0,
      tradeAllowed: true,
      expertAllowed: true,
      accountTradeMode: 0,
      accountTradeModeName: 'demo',
      ...next,
    });
  };
  const setPortfolio = () => {
    session.setPortfolio({ accountLogin: '001234', capturedAtMs: 1745700001000, positions: [], orders: [] });
  };
  const updateCandle = () => {
    session.setLatestCandle((candle) => (candle ? { ...candle, close: '1.0852' } : candle));
  };
  const setBridgeStatus = () => session.setStatus({ state: 'connected', message: 'Harness bridge is connected.' });
  const loadedCandle = {
    timeMs: 1745700000000,
    open: '1.0846',
    high: '1.0860',
    low: '1.0840',
    close: '1.0850',
    tickVolume: 10,
    spread: 2,
    realVolume: 0,
  };
  const loadCandle = () => {
    session.setSnapshot({
      symbol: 'EURUSD',
      timeframe: 'M5',
      complete: true,
      candles: [loadedCandle],
    });
    session.setLatestCandle(loadedCandle);
  };
  return (
    <div data-testid="provider-probe-ready">
      <button type="button" onClick={updateQuote}>
        Update quote
      </button>
      <button type="button" onClick={setBridgeStatus}>
        Set test bridge status
      </button>
      <button type="button" onClick={() => session.setTauriAvailable(false)}>
        Mark Tauri unavailable
      </button>
      <button type="button" onClick={moveQuote}>
        Move quote
      </button>
      <button type="button" onClick={updateCandle}>
        Update candle
      </button>
      <button type="button" onClick={loadCandle}>
        Load candle
      </button>
      <button type="button" onClick={() => setAccount()}>
        Set test account
      </button>
      <button
        type="button"
        onClick={() => session.setAccount((account) => (account ? { ...account, balance: '2000.00' } : undefined))}
      >
        Update balance
      </button>
      <button type="button" onClick={() => setAccount({ currency: 'EUR' })}>
        Set EUR account
      </button>
      <button type="button" onClick={() => setAccount({ accountTradeMode: 2, accountTradeModeName: 'real' })}>
        Set real account
      </button>
      <button type="button" onClick={setPortfolio}>
        Set test portfolio
      </button>
    </div>
  );
}

function TicketControls() {
  const bridge = useBridgeSessionRuntime();
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef } = useChartResources();
  const ticket = useOrderTicketRuntime({
    chart,
    stagedOrderState,
    instrumentDigitsRef,
    stagedActiveRef,
    instrument: bridge.instrument,
    account: bridge.account,
    quote: bridge.quote,
    snapshot: bridge.snapshot,
    latestCandle: bridge.latestCandle,
    status: bridge.status,
  });
  const configureActionGate = () => {
    const instrument: BrokerSymbol = {
      symbol: 'EURUSD',
      description: 'Euro vs US Dollar',
      digits: 5,
      tickSize: '0.00001',
      pointSize: '0.00001',
      contractSize: '100000',
      volumeMin: '0.01',
      volumeMax: '100',
      volumeStep: '0.01',
      stopsLevel: 0,
      freezeLevel: 0,
      fillingMode: 0,
      orderMode: 0,
      expirationMode: 0,
      tradeExecution: 0,
      tradeMode: 0,
    };
    bridge.setStatus({ state: 'connected', message: 'Harness bridge is connected.' });
    bridge.setSnapshot({ symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: [] });
    bridge.setInstrument(instrument);
    bridge.setAccount({
      accountLogin: '001234',
      brokerServer: 'Broker-Demo',
      currency: 'USD',
      currencyDigits: 2,
      balance: '1000.00',
      equity: '1000.00',
      margin: '0.00',
      freeMargin: '1000.00',
      marginLevel: '0',
      leverage: 100,
      marginMode: 0,
      tradeAllowed: true,
      expertAllowed: true,
      accountTradeMode: 0,
      accountTradeModeName: 'demo',
    });
    bridge.setQuote({
      symbol: 'EURUSD',
      timeMs: 1745700001000,
      bid: '1.0850',
      ask: '1.0852',
      last: '1.0850',
      volume: 10,
      volumeReal: '0',
      flags: 0,
    });
    ticket.setStagedOnChart(true);
    ticket.setRiskSide('buy');
    ticket.setEntry('1.0850');
    ticket.setUnitsMode('units');
    ticket.setSlOn(false);
    ticket.setOrderVolume('1');
  };

  return (
    <>
      <button type="button" onClick={() => ticket.setEntry('1.2345')}>
        Edit ticket
      </button>
      <button type="button" onClick={() => ticket.applyUnitsMode('money')}>
        Use money sizing
      </button>
      <button type="button" onClick={configureActionGate}>
        Prepare action gate
      </button>
      <button type="button" onClick={() => ticket.setEntry('1.0851')}>
        Change action entry
      </button>
      <button type="button" onClick={() => ticket.setTimeInForce('ioc')}>
        Change action time in force
      </button>
      <button type="button" onClick={() => ticket.setOrderVolume('0')}>
        Invalidate action volume
      </button>
      <button type="button" onClick={() => bridge.setAccount(undefined)}>
        Remove action account
      </button>
      <button
        type="button"
        onClick={() => bridge.setStatus({ state: 'disconnected', message: 'Harness disconnected.' })}
      >
        Disconnect action bridge
      </button>
      <button
        type="button"
        onClick={() =>
          bridge.setStatus({
            state: 'connected',
            message: 'Harness bridge is connected.',
            marketSession: { symbol: 'EURUSD', isOpen: false, tradeMode: 0, serverTimeMs: 1745700001000 },
          })
        }
      >
        Close action market
      </button>
      <button type="button" onClick={() => ticket.setRiskSide('sell')}>
        Change action side
      </button>
      <button type="button" onClick={() => ticket.setOrderCheckLoading(true)}>
        Load action check
      </button>
    </>
  );
}

function TicketActionProbe() {
  const action = useOrderTicketAction();
  return (
    <output data-testid="probe-ticket-action">
      {String(action.canCheckOrder)}|{String(action.orderCheckLoading)}|{action.side}
    </output>
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
    <>
      <ChartWorkspaceProvider>
        <BridgeSessionProvider>
          <Probe id="secondary-market">
            <SecondaryBridgeProbes />
          </Probe>
        </BridgeSessionProvider>
      </ChartWorkspaceProvider>
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
          <ChartHeaderProbes />
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
              <Probe id="ticket-header">
                <TicketHeaderProbe />
              </Probe>
              <Probe id="ticket-edit">
                <TicketEditProbe />
              </Probe>
              <Probe id="ticket-quotes">
                <OrderTicketQuotes />
              </Probe>
              <Probe id="ticket-extra-settings">
                <OrderTicketExtraSettings />
              </Probe>
              <Probe id="ticket-sizing">
                <OrderTicketSizing />
              </Probe>
              <Probe id="ticket-tick-value">
                <OrderTicketTickValue />
              </Probe>
              <Probe id="ticket-exits">
                <OrderTicketExits />
              </Probe>
              <Probe id="ticket-action">
                <TicketActionProbe />
                <OrderTicketReviewAction />
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
    </>
  );
}

export function mountProviderIsolationHarness(container: HTMLElement): void {
  const target = getHarnessWindow();
  target.__providerProbeCounts = {};
  target.__resetProviderProbeCounts = () => {
    target.__providerProbeCounts = {};
  };

  createRoot(container).render(
    <ErrorNotificationsProvider>
      <PanelVisibilityProvider>
        <WorkspaceProbes />
      </PanelVisibilityProvider>
    </ErrorNotificationsProvider>,
  );
}
