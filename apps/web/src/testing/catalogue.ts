import { http, HttpResponse } from 'msw';

import { eventPage } from './catalogue-fixtures.js';
import { type Schemas, server } from './msw-server.js';

type EventPage = Schemas['CatalogueEventPage_Output'];

/**
 * Answers `GET /api/events` with `respond(query)` and records each request's query, in order. The
 * default answer is an empty page.
 */
export function mockEventList(
  respond: (query: URLSearchParams) => EventPage | Response | Promise<EventPage | Response> = () =>
    eventPage([]),
): URLSearchParams[] {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get('/api/events', async ({ request }) => {
      const query = new URL(request.url).searchParams;
      requests.push(query);
      const result = await respond(query);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return requests;
}
