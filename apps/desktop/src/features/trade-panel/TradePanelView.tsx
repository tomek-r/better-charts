import type { ReactNode } from 'react';
import { usePanelOpen } from '../app-header/PanelVisibilityProvider';

export function TradePanelView({ children }: { children: ReactNode }) {
  const panelOpen = usePanelOpen();

  return <aside className={`trade-panel${panelOpen ? ' open' : ''}`}>{children}</aside>;
}
