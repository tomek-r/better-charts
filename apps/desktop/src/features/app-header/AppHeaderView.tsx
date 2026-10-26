import { useAppSettingsActions } from '../settings/AppSettingsProvider';
import { useSideDrawerActions, useSideDrawerOpen } from '../side-drawers/SideDrawerProvider';
import { useSymbolSearchControls } from '../symbol-search/SymbolSearchProvider';
import { TopBar } from '../topbar/TopBar';

/** Wires drawer, search and settings controls into the topbar's presentation. */
export function AppHeaderView() {
  const panelOpen = useSideDrawerOpen('tradePanel');
  const { toggleDrawer } = useSideDrawerActions();
  const { setSearchOpen } = useSymbolSearchControls();
  const { openSettings } = useAppSettingsActions();
  const togglePanel = () => toggleDrawer('tradePanel');

  return (
    <TopBar
      panelOpen={panelOpen}
      onTogglePanel={togglePanel}
      setSearchOpen={setSearchOpen}
      openSettings={openSettings}
    />
  );
}
