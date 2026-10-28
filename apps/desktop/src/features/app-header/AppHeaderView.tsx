import { useAppPlatform, useAppSettingsActions } from '../settings/AppSettingsProvider';
import { useSideDrawerActions, useSideDrawerOpen } from '../side-drawers/SideDrawerProvider';
import { useSymbolSearchControls } from '../symbol-search/SymbolSearchProvider';
import { searchShortcutLabel } from '../topbar/searchShortcutLabel';
import { TopBar } from '../topbar/TopBar';

/** Wires drawer, search and settings controls into the topbar's presentation. */
export function AppHeaderView() {
  const panelOpen = useSideDrawerOpen('tradePanel');
  const { toggleDrawer } = useSideDrawerActions();
  const { setSearchOpen } = useSymbolSearchControls();
  const { openSettings } = useAppSettingsActions();
  const platform = useAppPlatform();

  return (
    <TopBar
      panelOpen={panelOpen}
      searchShortcut={platform && searchShortcutLabel(platform)}
      onTogglePanel={() => toggleDrawer('tradePanel')}
      onOpenSearch={() => setSearchOpen(true)}
      onOpenSettings={openSettings}
    />
  );
}
