import { AppLifecycle } from '../../lifecycle/AppLifecycle';
import { AccountSwitchGuard } from '../account-switch/AccountSwitchGuard';
import { AppHeaderFeature } from '../app-header/AppHeaderFeature';
import { BridgeSessionProvider } from '../bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider } from '../chart/ChartWorkspaceProvider';
import { ChartWorkspaceView } from '../chart/ChartWorkspaceView';
import { ChartSettingsProvider } from '../chart/chartSettings/ChartSettingsProvider';
import { DrawingSettingsProvider } from '../tools/drawingSettings/DrawingSettingsProvider';
import { DrawingToolsView } from '../tools/DrawingToolsView';
import { ExecutionProvider } from '../execution/ExecutionProvider';
import { IndicatorSettingsProvider } from '../indicators/IndicatorSettingsProvider';
import { ObjectTreeDrawer } from '../object-tree/ObjectTreeDrawer';
import { OrderTicketPanel } from '../order-ticket/OrderTicketPanel';
import { OrderTicketProvider } from '../order-ticket/OrderTicketProvider';
import { SymbolChangeTicketReset } from '../order-ticket/lifecycle/SymbolChangeTicketReset';
import { SideDrawerStrip } from '../side-drawers/SideDrawerStrip';
import { AppSettingsScope } from '../settings/AppSettingsScope';
import { SymbolSearchProvider } from '../symbol-search/SymbolSearchProvider';
import { SymbolSearchView } from '../symbol-search/SymbolSearchView';

export function AppWorkspaceView() {
  return (
    <ChartWorkspaceProvider>
      <BridgeSessionProvider>
        {/* The chart's settings come from the chart, account and symbol the bridge reports. */}
        <ChartSettingsProvider>
          <AppSettingsScope>
            <SymbolSearchProvider>
              <AppHeaderFeature />
              <SymbolSearchView />
            </SymbolSearchProvider>
            <DrawingToolsView />
            <SideDrawerStrip />
            <ExecutionProvider>
              <main className="dashboard">
                {/* One settings dialog each for the chart's drawings and its indicators, shared the same way. */}
                <DrawingSettingsProvider>
                  <IndicatorSettingsProvider>
                    <ChartWorkspaceView />
                    <ObjectTreeDrawer />
                  </IndicatorSettingsProvider>
                </DrawingSettingsProvider>
                <OrderTicketProvider>
                  <OrderTicketPanel />
                  <AppLifecycle />
                  <AccountSwitchGuard />
                  <SymbolChangeTicketReset />
                </OrderTicketProvider>
              </main>
            </ExecutionProvider>
          </AppSettingsScope>
        </ChartSettingsProvider>
      </BridgeSessionProvider>
    </ChartWorkspaceProvider>
  );
}
