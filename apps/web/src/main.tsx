import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
// The `react-router/dom` provider supports `navigate(to, { flushSync: true })` (see `useLogout`).
import { RouterProvider } from 'react-router/dom';

import { AppProviders } from './app/AppProviders.js';
import { createQueryClient } from './app/query-client.js';
import { routes } from './app/routes.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html has no #root element');
}

const router = createBrowserRouter(routes);

createRoot(container).render(
  <StrictMode>
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
