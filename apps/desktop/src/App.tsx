import { SideDrawerProvider } from './features/side-drawers/SideDrawerProvider';
import { AppWorkspaceView } from './features/app-workspace/AppWorkspaceView';
import { ErrorNotificationsProvider } from './shared/ui/notification/ErrorNotifications';

export default function App() {
  return (
    <ErrorNotificationsProvider>
      <SideDrawerProvider>
        <AppWorkspaceView />
      </SideDrawerProvider>
    </ErrorNotificationsProvider>
  );
}
