import { PanelVisibilityProvider } from './features/app-header/PanelVisibilityProvider';
import { AppWorkspaceView } from './features/app-workspace/AppWorkspaceView';

export default function App() {
  return (
    <PanelVisibilityProvider>
      <AppWorkspaceView />
    </PanelVisibilityProvider>
  );
}
