import { AppSettingsDialog } from './AppSettingsDialog';
import { useAppSettingsView } from './AppSettingsProvider';
import { SetupGuideModal } from './setup-guide-modal/SetupGuideModal';
import { useCompleteSetupOnConnect } from './useCompleteSetupOnConnect';

export function AppSettingsView() {
  const settings = useAppSettingsView();
  useCompleteSetupOnConnect();
  if (!settings.isOpen) {
    // The guide also opens on its own (a first launch without the EA, or a notice offering the
    // install), with no settings dialog underneath it.
    return settings.setupGuideOpen ? (
      <SetupGuideModal
        onClose={settings.closeSetupGuide}
        onFinished={settings.finishSetupGuide}
        finishing={settings.setupGuideFinishing}
        standalone
      />
    ) : null;
  }

  return (
    <AppSettingsDialog
      settings={settings.settings}
      loadRequest={settings.loadRequest}
      closing={settings.closing}
      guideOpen={settings.setupGuideOpen}
      guideFinishing={settings.setupGuideFinishing}
      loadError={settings.loadError}
      onClose={settings.close}
      onOpenGuide={settings.openSetupGuide}
      onCloseGuide={settings.closeSetupGuide}
      onGuideFinished={settings.finishSetupGuide}
      onExited={settings.exited}
      onSaved={settings.saved}
    />
  );
}
