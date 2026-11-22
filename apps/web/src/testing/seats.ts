import { http, HttpResponse } from 'msw';

import { type Schemas, server } from './msw-server.js';

type SeatMap = Schemas['SeatMap_Output'];

/**
 * Answers `GET /api/events/{eventId}/seats` with `respond()`, called once per request (so a test can
 * change the map between fetches), and returns how many requests it answered so far.
 */
export function mockSeatMap(
  eventId: string,
  respond: () => SeatMap | Response,
): { readonly requests: number } {
  const calls = { requests: 0 };
  server.use(
    http.get(`/api/events/${eventId}/seats`, () => {
      calls.requests++;
      const result = respond();
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return calls;
}

/** `map` with the given seats' status changed, e.g. to show them taken by someone else. */
export function withSeatStatus(
  map: SeatMap,
  seatIds: readonly string[],
  status: Schemas['SeatStatus_Output'],
): SeatMap {
  const ids = new Set(seatIds);
  return {
    ...map,
    sections: map.sections.map((section) =>
      section.type === 'GA'
        ? section
        : withAvailableCount({
            ...section,
            rows: section.rows.map((row) => ({
              ...row,
              seats: row.seats.map((seat) => (ids.has(seat.id) ? { ...seat, status } : seat)),
            })),
          }),
    ),
  };
}

function withAvailableCount(section: Schemas['SeatMapSeatedSection_Output']) {
  const available = section.rows
    .flatMap(({ seats }) => seats)
    .filter((seat) => seat.status === 'AVAILABLE').length;
  return { ...section, available };
}
