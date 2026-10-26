import { useState } from 'react';
import { SideDrawer } from '../side-drawers/SideDrawer';
import { useSideDrawerOpen } from '../side-drawers/SideDrawerProvider';
import { OrderTicketPanelContent } from './OrderTicketPanelContent';

export function OrderTicketPanel() {
  const panelOpen = useSideDrawerOpen('tradePanel');
  const [hasOpened, setHasOpened] = useState(panelOpen);

  if (panelOpen && !hasOpened) {
    setHasOpened(true);
  }

  return (
    <SideDrawer open={panelOpen} className="trade-panel">
      {hasOpened && <OrderTicketPanelContent />}
    </SideDrawer>
  );
}
