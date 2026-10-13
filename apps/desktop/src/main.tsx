import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'virtual:palette.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
