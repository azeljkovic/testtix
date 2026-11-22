import { http, HttpResponse } from 'msw';

import { adminEvents, adminVenues, eventSummary, page, venueSummary } from './admin-fixtures.js';
import { problemResponse } from './problems.js';

/** Default answers of the admin API: the fixtures in `./admin-fixtures.js`. */
export const adminHandlers = [
  http.get('/api/admin/events', () => HttpResponse.json(page(adminEvents.map(eventSummary)))),
  http.get('/api/admin/events/:eventId', ({ params }) => {
    const event = adminEvents.find(({ id }) => id === params.eventId);
    return event ? HttpResponse.json(event) : problemResponse({ status: 404 });
  }),
  http.get('/api/admin/venues', () => HttpResponse.json(page(adminVenues.map(venueSummary)))),
  http.get('/api/admin/venues/:venueId', ({ params }) => {
    const venue = adminVenues.find(({ id }) => id === params.venueId);
    return venue ? HttpResponse.json(venue) : problemResponse({ status: 404 });
  }),
];
