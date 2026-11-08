import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './i18n';
import { initInstallPrompt } from './pwa';
import './styles/global.css';

initInstallPrompt();
// Service worker: offline app shell, API cache fallback and push notifications.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
