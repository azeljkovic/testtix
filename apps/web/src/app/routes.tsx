import type { RouteObject } from 'react-router';

import { RequireAuth } from '../auth/RequireAuth.js';
import { RootLayout } from '../layout/RootLayout.js';
import { AccountPage } from '../pages/AccountPage.js';
import { AdminPage } from '../pages/AdminPage.js';
import { EventsPage } from '../pages/EventsPage.js';
import { HomePage } from '../pages/HomePage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { RegisterPage } from '../pages/RegisterPage.js';
import { VerifyEmailPage } from '../pages/VerifyEmailPage.js';

/** Route table shared by the browser router (`main.tsx`) and the memory router in tests. */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      // The API's verification emails link here (`VERIFY_EMAIL_PATH` in apps/api).
      { path: 'verify-email', element: <VerifyEmailPage /> },
      // Logged-in users only.
      { element: <RequireAuth />, children: [{ path: 'account', element: <AccountPage /> }] },
      // Admins only.
      {
        element: <RequireAuth role="ADMIN" />,
        children: [{ path: 'admin', element: <AdminPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
