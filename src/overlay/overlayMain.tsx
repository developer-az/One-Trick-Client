import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource/cinzel/700.css';
import '../index.css';
import '../app/tokens.css';
import './overlay-theme.css';
import { OverlayApp } from './OverlayApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
);
