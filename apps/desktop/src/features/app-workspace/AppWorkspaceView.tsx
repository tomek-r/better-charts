import { AppLifecycle } from '../../lifecycle/AppLifecycle';
import { AccountSwitchGuard } from '../account-switch/AccountSwitchGuard';
import { AppHeaderFeature } from '../app-header/AppHeaderFeature';
import { BridgeSessionProvider } from '../bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider } from '../chart/ChartWorkspaceProvider';
import { ChartWorkspaceView } from '../chart/ChartWorkspaceView';
import { DrawingSettingsProvider } from '../tools/drawingSettings/DrawingSettingsProvider';
import { DrawingToolsView } from '../tools/DrawingToolsView';
import { ExecutionProvider } from '../execution/ExecutionProvider';
import { ObjectTreeDrawer } from '../object-tree/ObjectTreeDrawer';
import { OrderTicketPanel } from '../order-ticket/OrderTicketPanel';
import { OrderTicketProvider } from '../order-ticket/OrderTicketProvider';
import { SymbolChangeTicketReset } from '../order-ticket/lifecycle/SymbolChangeTicketReset';
import { SideDrawerStrip } from '../side-drawers/SideDrawerStrip';
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
        <SideDrawerStrip />
        <ExecutionProvider>
          <main className="dashboard">
            {/* One settings dialog for the chart's toolbar and the object tree, which both open it. */}
            <DrawingSettingsProvider>
              <ChartWorkspaceView />
              <ObjectTreeDrawer />
            </DrawingSettingsProvider>
            <OrderTicketProvider>
              <OrderTicketPanel />
              <AppLifecycle />
              <AccountSwitchGuard />
              <SymbolChangeTicketReset />
            </OrderTicketProvider>
          </main>
        </ExecutionProvider>
      </BridgeSessionProvider>
    </ChartWorkspaceProvider>
  );
}
