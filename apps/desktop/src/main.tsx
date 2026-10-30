import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { suppressNativeContextMenu } from './features/app-workspace/nativeContextMenu';
import 'virtual:palette.css';
import './styles.css';

// Dev keeps the native menu for Inspect Element; production suppresses it because it freezes the chart on macOS.
if (!import.meta.env.DEV) {
  suppressNativeContextMenu(document);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
