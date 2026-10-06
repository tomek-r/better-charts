import { PanelVisibilityProvider } from './features/app-header/PanelVisibilityProvider';
import { AppWorkspaceView } from './features/app-workspace/AppWorkspaceView';
import { ErrorNotificationsProvider } from './shared/ui/ErrorNotifications';

export default function App() {
  return (
    <ErrorNotificationsProvider>
      <PanelVisibilityProvider>
        <AppWorkspaceView />
      </PanelVisibilityProvider>
    </ErrorNotificationsProvider>
  );
}
