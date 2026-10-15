import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { ActorProvider } from './lib/actor';
import { ToastProvider } from './lib/toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ActorProvider>
        <App />
      </ActorProvider>
    </ToastProvider>
  </StrictMode>,
);
