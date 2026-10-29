import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { suppressNativeContextMenu } from './features/app-workspace/nativeContextMenu';
import 'virtual:palette.css';
import './styles.css';

suppressNativeContextMenu(document);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
