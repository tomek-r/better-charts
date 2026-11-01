import { useEffect, useRef } from 'react';
import { ResetViewIcon } from '../../../shared/ui/icons/ResetViewIcon';
import { SettingsIcon } from '../../../shared/ui/icons/SettingsIcon';
import { useAppPlatform } from '../../settings/AppSettingsProvider';
import { resetViewShortcutLabel } from './resetViewShortcutLabel';

/**
 * The menu of the chart's right-click: the entry that restores the view the chart showed when it loaded,
 * then the one that opens the chart's settings.
 */
export function ChartContextMenu({
  onResetView,
  onOpenSettings,
}: {
  onResetView: () => void;
  onOpenSettings: () => void;
}) {
  const resetItem = useRef<HTMLButtonElement>(null);
  const platform = useAppPlatform();
  useEffect(() => {
    resetItem.current?.focus();
  }, []);

  return (
    <div className="ticket-menu chart-context-menu" role="menu" aria-label="Chart">
      <button ref={resetItem} type="button" role="menuitem" className="ticket-menu-item" onClick={onResetView}>
        <ResetViewIcon className="chart-context-menu-icon" />
        <span className="chart-context-menu-label">Reset chart view</span>
        {platform && <kbd className="chart-context-menu-shortcut">{resetViewShortcutLabel(platform)}</kbd>}
      </button>
      <div role="separator" className="chart-context-menu-separator" />
      <button type="button" role="menuitem" className="ticket-menu-item" onClick={onOpenSettings}>
        <SettingsIcon className="chart-context-menu-icon" />
        <span className="chart-context-menu-label">Settings</span>
      </button>
    </div>
  );
}
