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
      guideOpen={settings.setupGuideOpen}
      loadError={settings.loadError}
      onClose={settings.close}
      onOpenGuide={settings.openSetupGuide}
      onCloseGuide={settings.closeSetupGuide}
      onExited={settings.exited}
      onSaved={settings.saved}
    />
  );
}
