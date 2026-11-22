import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES, type HoldRequest } from '@testtix/shared';
import { http, HttpResponse } from 'msw';

import { mockAdminRequest, type RecordedRequest } from './admin.js';
import { type Schemas, server } from './msw-server.js';
import { problemResponse } from './problems.js';

type Hold = Schemas['Hold_Output'];
type HoldItem = Schemas['HoldItem_Output'];
type SeatMap = Schemas['SeatMap_Output'];

export const FIXTURE_HOLD_ID = '01970000-0000-7000-8000-000000000a01';

interface HoldOptions {
  /** Defaults to `Date.now()` when the hold is built (the fake clock, in tests that fake `Date`). */
  createdAt?: number;
  /** Defaults to the map's `holdDurationSec`. */
  durationSec?: number;
  id?: string;
}

/**
 * The hold the API would make for `request` on `map`: one item per seat, and per GA place at the
 * cheapest prices first. Throws for seats or sections that aren't on the map.
 */
export function holdOf(
  map: SeatMap,
  request: Partial<HoldRequest>,
  {
    createdAt = Date.now(),
    durationSec = map.holdDurationSec,
    id = FIXTURE_HOLD_ID,
  }: HoldOptions = {},
): Hold {
  const wanted = new Set(request.seats ?? []);
  const items: HoldItem[] = [];
  let unit = 0;
  const unitId = () => `01970000-0000-7000-8000-0000000b${(unit++).toString(16).padStart(4, '0')}`;
  for (const section of map.sections) {
    const ref = { id: section.id, name: section.name, type: section.type };
    if (section.type === 'SEATED') {
      for (const row of section.rows) {
        for (const seat of row.seats) {
          if (!wanted.delete(seat.id)) continue;
          items.push({
            inventoryUnitId: unitId(),
            section: ref,
            seat: { id: seat.id, row: row.label, number: seat.number },
            priceCents: seat.priceCents ?? 0,
          });
        }
      }
      continue;
    }
    let quantity = request.ga?.find(({ sectionId }) => sectionId === section.id)?.quantity ?? 0;
    for (const tier of section.prices) {
      const taken = Math.min(quantity, tier.available);
      for (let i = 0; i < taken; i++) {
        items.push({
          inventoryUnitId: unitId(),
          section: ref,
          seat: null,
          priceCents: tier.priceCents,
        });
      }
      quantity -= taken;
    }
  }
  if (wanted.size > 0) throw new Error(`Seats not on the map: ${[...wanted].join(', ')}`);
  return {
    id,
    eventId: map.eventId,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + durationSec * 1000).toISOString(),
    totalCents: items.reduce((sum, item) => sum + item.priceCents, 0),
    items,
  };
}

/**
 * Answers `GET /api/holds/current` with `hold` (404 for `null`, as the API does when there is none),
 * and returns the `eventId` of each request.
 */
export function mockCurrentHold(hold: Hold | null): (string | null)[] {
  const eventIds: (string | null)[] = [];
  server.use(
    http.get('/api/holds/current', ({ request }) => {
      eventIds.push(new URL(request.url).searchParams.get('eventId'));
      return hold === null ? problemResponse({ status: 404 }) : HttpResponse.json(hold);
    }),
  );
  return eventIds;
}

/**
 * Answers `POST /api/events/{eventId}/holds` with `respond(body)`, a hold (201) or a `Response`, and
 * records each request (body, CSRF header).
 */
export function mockCreateHold(
  eventId: string,
  respond: (body: HoldRequest) => Hold | Response,
): RecordedRequest[] {
  return mockAdminRequest('post', `/api/events/${eventId}/holds`, ({ body }) =>
    respond(body as HoldRequest),
  );
}

/** Answers `DELETE /api/holds/{holdId}` with `respond()` (204 by default) and records each request. */
export function mockReleaseHold(respond: () => Response | undefined = () => undefined) {
  return mockAdminRequest('delete', '/api/holds/:holdId', respond);
}

/** The API's 409 `tickets-unavailable`: nothing was held, and the body says what was missing. */
export function ticketsUnavailableResponse({
  unavailableSeatIds = [],
  gaShortfalls = [],
}: Partial<Pick<Schemas['TicketsUnavailableProblem'], 'unavailableSeatIds' | 'gaShortfalls'>>) {
  const body: Schemas['TicketsUnavailableProblem'] = {
    type: PROBLEM_TYPES.TICKETS_UNAVAILABLE,
    title: 'Tickets unavailable',
    status: 409,
    detail: 'Some of the requested tickets are not available.',
    instance: '/mock',
    requestId: 'req-mock',
    errors: [],
    unavailableSeatIds,
    gaShortfalls,
  };
  return HttpResponse.json(body, {
    status: 409,
    headers: { 'Content-Type': PROBLEM_CONTENT_TYPE },
  });
}
