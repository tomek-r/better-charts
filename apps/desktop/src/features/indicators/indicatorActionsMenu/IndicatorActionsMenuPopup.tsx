import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { VISIBILITY_TAB_ID } from '../../chart/settingsForm/settingsTabModel';
import { useChartSettings } from '../../chart/chartSettings/ChartSettingsProvider';
import { useOutsidePointerDismissal } from '../../../shared/ui/popup/useDismissal';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import { useOpenIndicatorSettings } from '../IndicatorSettingsProvider';
import { useIndicatorRowCommands } from '../useIndicatorCommands';
import { IndicatorActionsMenu } from './IndicatorActionsMenu';
import type { IndicatorActionsMenuRequest } from './indicatorActionsMenuRequest';
import { visualOrderTargets } from './indicatorVisualOrder';

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
  usePopupPlacement(anchorRef, menuRef);
  useOutsidePointerDismissal(menuRef, onClose);

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
  const moveTo = (targetInstanceId: string | undefined) => {
    if (targetInstanceId === undefined) {
      return;
    }
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
        onBringToFront={() => moveTo(visualOrder?.frontInstanceId)}
        onSendToBack={() => moveTo(visualOrder?.backInstanceId)}
        onOpenVisibility={openVisibility}
        onSetHidden={setHidden}
        onRemove={remove}
        onOpenSettings={openSettings}
        onClose={closeToOpener}
      />
    </>,
    document.body,
  );
}
