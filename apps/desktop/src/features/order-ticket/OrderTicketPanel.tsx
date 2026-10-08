import { useState } from 'react';
import { usePanelOpen } from '../app-header/PanelVisibilityProvider';
import { OrderTicketPanelContent } from './OrderTicketPanelContent';

export function OrderTicketPanel() {
  const panelOpen = usePanelOpen();
  const [hasOpened, setHasOpened] = useState(panelOpen);

  if (panelOpen && !hasOpened) {
    setHasOpened(true);
  }

  return <aside className={`trade-panel${panelOpen ? ' open' : ''}`}>{hasOpened && <OrderTicketPanelContent />}</aside>;
}
