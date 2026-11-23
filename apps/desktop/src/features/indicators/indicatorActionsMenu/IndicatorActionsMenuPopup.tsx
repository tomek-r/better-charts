import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { VISIBILITY_TAB_ID } from '../../chart/settingsForm/settingsTabModel';
import { useChartSettings } from '../../chart/chartSettings/ChartSettingsProvider';
import { useSideDrawerActions } from '../../side-drawers/SideDrawerProvider';
import { useOutsidePointerDismissal } from '../../../shared/ui/popup/useDismissal';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import { useOpenIndicatorSettings } from '../IndicatorSettingsProvider';
import { useIndicatorRowCommands } from '../useIndicatorCommands';
import { IndicatorActionsMenu } from './IndicatorActionsMenu';
import type { IndicatorActionsMenuRequest } from './indicatorActionsMenuRequest';
import { visualOrderTargets } from './indicatorVisualOrder';

/**
 * Marks a menu button that opened the menu as expanded for as long as the menu is open. A legend row reads the mark
 * to keep its buttons in sight while the pointer and the focus are in the menu; an object tree row name, which is
 * no menu button, is left alone.
 */
function useOpenerExpanded(opener: HTMLElement): void {
  useEffect(() => {
    if (opener.getAttribute('aria-haspopup') !== 'menu') {
      return undefined;
    }
    opener.setAttribute('aria-expanded', 'true');
    return () => opener.setAttribute('aria-expanded', 'false');
  }, [opener]);
}

interface IndicatorActionsMenuPopupProps {
  readonly request: IndicatorActionsMenuRequest;
  /** Closes the menu without moving the focus, which a press outside it does. */
  readonly onClose: () => void;
}

/**
 * The actions menu of one indicator, hung from the point that opened it and portalled to the page body: the chart
 * frame clips what it holds, and the object tree opens this same menu from its own drawer.
 */
export function IndicatorActionsMenuPopup({ request, onClose }: IndicatorActionsMenuPopupProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { settings } = useChartSettings();
  const commands = useIndicatorRowCommands();
  const openIndicatorSettings = useOpenIndicatorSettings();
  const { openDrawer } = useSideDrawerActions();
  usePopupPlacement(anchorRef, menuRef);
  useOutsidePointerDismissal(menuRef, onClose);
  useOpenerExpanded(request.returnFocus);

  const saved = settings.indicators.find((indicator) => indicator.instanceId === request.instanceId);
  if (saved === undefined) {
    return null;
  }
  const visualOrder = visualOrderTargets(settings.indicators, request.instanceId);

  /** Closes the menu and hands the focus back to the button or the row it was opened from. */
  const closeToOpener = () => {
    onClose();
    request.returnFocus.focus();
  };
  const setHidden = () => {
    commands.setHidden(request.instanceId, saved.hidden !== true);
    closeToOpener();
  };
  const remove = () => {
    commands.remove(request.instanceId);
    onClose();
  };
  const openVisibility = () => {
    onClose();
    openIndicatorSettings(request.instanceId, VISIBILITY_TAB_ID);
  };
  const openSettings = () => {
    onClose();
    openIndicatorSettings(request.instanceId);
  };
  const openObjectTree = () => {
    onClose();
    openDrawer('objectTree');
  };
  const moveInVisualOrder = (targetInstanceId: string) => {
    commands.moveIndicatorRow(request.instanceId, targetInstanceId);
    closeToOpener();
  };

  return createPortal(
    <>
      {/* The point the menu is placed against, which the placement keeps inside the window. */}
      <div ref={anchorRef} className="indicator-actions-menu-anchor" style={{ left: request.x, top: request.y }} />
      <IndicatorActionsMenu
        menuRef={menuRef}
        hidden={saved.hidden === true}
        visualOrder={visualOrder}
        onMoveInVisualOrder={moveInVisualOrder}
        onOpenVisibility={openVisibility}
        onSetHidden={setHidden}
        onRemove={remove}
        onOpenObjectTree={request.origin === 'legend' ? openObjectTree : undefined}
        onOpenSettings={openSettings}
        onClose={closeToOpener}
      />
    </>,
    document.body,
  );
}
