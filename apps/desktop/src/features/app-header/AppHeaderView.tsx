import { useAppSettingsActions } from '../settings/AppSettingsProvider';
import { useSymbolSearchControls } from '../symbol-search/SymbolSearchProvider';
import { TopBar } from '../topbar/TopBar';
import { usePanelActions, usePanelOpen } from './PanelVisibilityProvider';

/** Wires drawer, search and settings controls into the topbar's presentation. */
export function AppHeaderView() {
  const panelOpen = usePanelOpen();
  const { setPanelOpen } = usePanelActions();
  const { setSearchOpen } = useSymbolSearchControls();
  const { openSettings } = useAppSettingsActions();

  return (
    <TopBar
      panelOpen={panelOpen}
      setPanelOpen={setPanelOpen}
      setSearchOpen={setSearchOpen}
      openSettings={openSettings}
    />
  );
}
