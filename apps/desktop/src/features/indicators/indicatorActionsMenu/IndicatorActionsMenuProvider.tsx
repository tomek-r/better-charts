import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRequiredContext } from '../../../shared/context/useRequiredContext';
import { IndicatorActionsMenuPopup } from './IndicatorActionsMenuPopup';
import type { IndicatorActionsMenuRequest } from './indicatorActionsMenuRequest';

/** What the app shares about the indicator actions menu: the one command that opens it. */
interface IndicatorActionsMenuContextValue {
  readonly openIndicatorActionsMenu: (request: IndicatorActionsMenuRequest) => void;
}

const IndicatorActionsMenuContext = createContext<IndicatorActionsMenuContextValue | null>(null);

/**
 * Opens the actions menu of one indicator, from a legend row's More button or from an object tree row. The
 * command keeps its identity while the provider does, so the legend is handed it once.
 */
export function useOpenIndicatorActionsMenu(): (request: IndicatorActionsMenuRequest) => void {
  const { openIndicatorActionsMenu } = useRequiredContext(
    IndicatorActionsMenuContext,
    'useOpenIndicatorActionsMenu must be used within IndicatorActionsMenuProvider.',
  );
  return openIndicatorActionsMenu;
}

export interface IndicatorActionsMenuProviderProps {
  readonly children: ReactNode;
}

/**
 * Holds the indicator whose actions menu is open and renders that one menu. It sits above the chart and the
 * object tree, so both open the same menu, and inside the settings provider, whose dialog its rows open.
 */
export function IndicatorActionsMenuProvider({ children }: IndicatorActionsMenuProviderProps) {
  const [request, setRequest] = useState<IndicatorActionsMenuRequest>();

  const openIndicatorActionsMenu = useCallback((next: IndicatorActionsMenuRequest) => setRequest(next), []);
  const closeActionsMenu = useCallback(() => setRequest(undefined), []);
  const contextValue = useMemo(() => ({ openIndicatorActionsMenu }), [openIndicatorActionsMenu]);

  return (
    <IndicatorActionsMenuContext value={contextValue}>
      {children}
      {request === undefined ? null : <IndicatorActionsMenuPopup request={request} onClose={closeActionsMenu} />}
    </IndicatorActionsMenuContext>
  );
}
