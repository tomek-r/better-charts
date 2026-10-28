import { AccountBadge } from '../account-badge/AccountBadge';
import { DemoAccountNotice } from '../demo-notice/DemoAccountNotice';
import { useChartDrawn } from '../chart/useChartDrawn';
import { BrandMark, PanelIcon, SearchIcon, SettingsIcon } from './topbarIcons';

export function TopBar({
  panelOpen,
  onTogglePanel,
  searchShortcut,
  onOpenSearch,
  onOpenSettings,
}: {
  panelOpen: boolean;
  /** Shortcut hint on the search button; absent until the platform is known. */
  searchShortcut: string | undefined;
  onTogglePanel: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}) {
  const chartDrawn = useChartDrawn();
  const actionsClassName = chartDrawn ? 'topbar-actions' : 'topbar-actions topbar-actions-waiting';
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span>Better Charts</span>
        <small>v{__APP_VERSION__}</small>
      </div>
      <div className={actionsClassName}>
        <AccountBadge />
        <button className="search-trigger" onClick={onOpenSearch} aria-label="Search symbols">
          <span className="search-trigger-label">
            <SearchIcon />
            Search symbols
          </span>
          {searchShortcut && <kbd>{searchShortcut}</kbd>}
        </button>
        <button
          className="panel-toggle"
          aria-label="Toggle trade panel"
          aria-expanded={panelOpen}
          onClick={onTogglePanel}
        >
          <PanelIcon />
          <span>Trade</span>
        </button>
        <button className="settings-trigger" aria-label="App settings" onClick={onOpenSettings}>
          <SettingsIcon />
        </button>
      </div>
      <DemoAccountNotice />
    </header>
  );
}
