import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { components } from '../api/generated/openapi.js';
import { adminHandlers } from './admin-handlers.js';
import {
  catalogueEventDetails,
  catalogueEvents,
  catalogueVenues,
  eventPage,
} from './catalogue-fixtures.js';
import { problemResponse } from './problems.js';

/** Response bodies from the OpenAPI spec, so a mock that drifts from the API fails the typecheck. */
export type Schemas = components['schemas'];

/** The token the default `GET /api/auth/csrf` handler hands out. */
export const MOCK_CSRF_TOKEN = 'mock-csrf-token';

/** Default API responses for component tests. Override per test with `server.use(...)`. */
export const handlers = [
  http.get('/api/health', () =>
    HttpResponse.json({ status: 'ok' } satisfies Schemas['LivenessDto_Output']),
  ),
  // Nobody is logged in; `logInAs(user)` from `./auth.js` changes that.
  http.get('/api/auth/me', () => problemResponse({ status: 401 })),
  http.get('/api/auth/csrf', () =>
    HttpResponse.json({ csrfToken: MOCK_CSRF_TOKEN } satisfies Schemas['CsrfTokenDto_Output']),
  ),
  // The catalogue fixtures; `mockEventList()` from `./catalogue.js` answers other lists.
  http.get('/api/events', () => HttpResponse.json(eventPage(catalogueEvents))),
  http.get('/api/events/:slug', ({ params }) => {
    const event = catalogueEventDetails.find(({ slug }) => slug === params.slug);
    return event ? HttpResponse.json(event) : problemResponse({ status: 404 });
  }),
  http.get('/api/venues', () =>
    HttpResponse.json({
      items: catalogueVenues,
      page: 1,
      pageSize: 100,
      total: catalogueVenues.length,
      totalPages: 1,
    } satisfies Schemas['CatalogueVenuePage_Output']),
  ),
  // The admin fixtures; `mockAdminRequest()` from `./admin.js` answers and records other calls.
  ...adminHandlers,
];

export const server = setupServer(...handlers);
