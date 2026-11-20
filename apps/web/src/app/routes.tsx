import type { RouteObject } from 'react-router';

import { RootLayout } from '../layout/RootLayout.js';
import { EventsPage } from '../pages/EventsPage.js';
import { HomePage } from '../pages/HomePage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';

/** Route table shared by the browser router (`main.tsx`) and the memory router in tests. */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
