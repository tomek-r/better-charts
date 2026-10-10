import { AppSettingsDialog } from './AppSettingsDialog';
import { useAppSettingsView } from './AppSettingsProvider';

export function AppSettingsView() {
  const settings = useAppSettingsView();
  if (!settings.isOpen) {
    return null;
  }

  return (
    <AppSettingsDialog
      settings={settings.settings}
      loadRequest={settings.loadRequest}
      closing={settings.closing}
      loadError={settings.loadError}
      onClose={settings.close}
      onExited={settings.exited}
      onSaved={settings.saved}
    />
  );
}
