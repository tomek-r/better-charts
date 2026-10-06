import { AppLifecycle } from '../../AppLifecycle';
import { AppHeaderFeature } from '../app-header/AppHeaderFeature';
import { BridgeSessionProvider } from '../bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider } from '../chart/ChartWorkspaceProvider';
import { ChartWorkspaceView } from '../chart/ChartWorkspaceView';
import { DrawingToolsView } from '../tools/DrawingToolsView';
import { ExecutionProvider } from '../execution/ExecutionProvider';
import { OrderTicketFeature } from '../order-ticket/OrderTicketFeature';
import { PortfolioView } from '../portfolio/PortfolioView';
import { SymbolSearchProvider } from '../symbol-search/SymbolSearchProvider';
import { SymbolSearchView } from '../symbol-search/SymbolSearchView';
import { TradePanelView } from '../trade-panel/TradePanelView';

export function AppWorkspaceView() {
  return (
    <ChartWorkspaceProvider>
      <BridgeSessionProvider>
        <SymbolSearchProvider>
          <AppHeaderFeature />
          <SymbolSearchView />
        </SymbolSearchProvider>
        <DrawingToolsView />
        <ExecutionProvider>
          <main className="dashboard">
            <ChartWorkspaceView />
            <TradePanelView>
              <OrderTicketFeature>
                <AppLifecycle />
              </OrderTicketFeature>
              <PortfolioView />
            </TradePanelView>
          </main>
        </ExecutionProvider>
      </BridgeSessionProvider>
    </ChartWorkspaceProvider>
  );
}
