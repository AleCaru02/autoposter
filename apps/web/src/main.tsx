import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { LocalE2EProvider } from './services/local-e2e';
import './styles-v2.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <LocalE2EProvider>
        <App />
      </LocalE2EProvider>
    </BrowserRouter>
  </StrictMode>,
);
