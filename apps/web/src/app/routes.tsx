import { Navigate, type RouteObject } from 'react-router';

import { AdminLayout } from '../admin/AdminLayout.js';

import { RequireAuth } from '../auth/RequireAuth.js';
import { RootLayout } from '../layout/RootLayout.js';
import { AccountPage } from '../pages/AccountPage.js';
import { AdminEventPage } from '../pages/admin/AdminEventPage.js';
import { AdminEventsPage } from '../pages/admin/AdminEventsPage.js';
import { AdminVenuesPage } from '../pages/admin/AdminVenuesPage.js';
import { EditEventPage, NewEventPage } from '../pages/admin/EventFormPage.js';
import { ReleaseBatchPage } from '../pages/admin/ReleaseBatchPage.js';
import { EditVenuePage, NewVenuePage } from '../pages/admin/VenueFormPage.js';
import { ChooseSeatsPage } from '../pages/ChooseSeatsPage.js';
import { EventDetailPage } from '../pages/EventDetailPage.js';
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
      { path: 'events/:slug', element: <EventDetailPage /> },
      { path: 'events/:slug/seats', element: <ChooseSeatsPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      // The API's verification emails link here (`VERIFY_EMAIL_PATH` in apps/api).
      { path: 'verify-email', element: <VerifyEmailPage /> },
      // Logged-in users only.
      { element: <RequireAuth />, children: [{ path: 'account', element: <AccountPage /> }] },
      // Admins only.
      {
        element: <RequireAuth role="ADMIN" />,
        children: [
          {
            path: 'admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="/admin/events" replace /> },
              { path: 'events', element: <AdminEventsPage /> },
              { path: 'events/new', element: <NewEventPage /> },
              { path: 'events/:eventId', element: <AdminEventPage /> },
              { path: 'events/:eventId/edit', element: <EditEventPage /> },
              { path: 'events/:eventId/batches/new', element: <ReleaseBatchPage /> },
              { path: 'venues', element: <AdminVenuesPage /> },
              { path: 'venues/new', element: <NewVenuePage /> },
              { path: 'venues/:venueId', element: <EditVenuePage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
