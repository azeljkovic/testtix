import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

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
