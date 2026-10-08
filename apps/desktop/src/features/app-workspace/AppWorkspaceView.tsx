import { AppLifecycle } from '../../AppLifecycle';
import { AppHeaderFeature } from '../app-header/AppHeaderFeature';
import { BridgeSessionProvider } from '../bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider } from '../chart/ChartWorkspaceProvider';
import { ChartWorkspaceView } from '../chart/ChartWorkspaceView';
import { DrawingToolsView } from '../tools/DrawingToolsView';
import { ExecutionProvider } from '../execution/ExecutionProvider';
import { OrderTicketPanel } from '../order-ticket/OrderTicketPanel';
import { OrderTicketProvider } from '../order-ticket/OrderTicketProvider';
import { SymbolSearchProvider } from '../symbol-search/SymbolSearchProvider';
import { SymbolSearchView } from '../symbol-search/SymbolSearchView';

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
            <OrderTicketProvider>
              <OrderTicketPanel />
              <AppLifecycle />
            </OrderTicketProvider>
          </main>
        </ExecutionProvider>
      </BridgeSessionProvider>
    </ChartWorkspaceProvider>
  );
}
