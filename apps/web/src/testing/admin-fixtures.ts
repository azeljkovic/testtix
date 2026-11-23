import type { Schemas } from './msw-server.js';

type AdminVenue = Schemas['AdminVenue_Output'];
type AdminVenueSummary = Schemas['AdminVenueSummary_Output'];
type AdminEvent = Schemas['AdminEvent_Output'];
type AdminEventSummary = Schemas['AdminEventSummary_Output'];
type TicketCounts = Schemas['TicketCounts_Output'];

/** Admin API data for component tests. Times are UTC; the venues are in New York. */

const seats = (rows: string[], perRow: number, prefix: string) =>
  rows.flatMap((row, r) =>
    Array.from({ length: perRow }, (_, n) => ({
      id: `01970000-0000-7000-8${prefix}-${String(r).padStart(4, '0')}${String(n + 1).padStart(8, '0')}`,
      row,
      number: n + 1,
    })),
  );

const STALLS_ID = '01970000-0000-7000-8000-0000000005a1';
const BALCONY_ID = '01970000-0000-7000-8000-0000000005a2';
const FLOOR_ID = '01970000-0000-7000-8000-0000000005a3';

/** Mixed layout: Stalls (2 × 3 seats), Balcony (1 × 4 seats), Floor (50 standing). Locked. */
export const adminRiverside: AdminVenue = {
  id: '01970000-0000-7000-8000-0000000000a1',
  slug: 'riverside-hall',
  name: 'Riverside Hall',
  address: '1 River Road',
  city: 'Springfield',
  timezone: 'America/New_York',
  capacity: 60,
  layoutLocked: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  sections: [
    {
      id: STALLS_ID,
      name: 'Stalls',
      type: 'SEATED',
      capacity: 6,
      seats: seats(['A', 'B'], 3, '001'),
    },
    {
      id: BALCONY_ID,
      name: 'Balcony',
      type: 'SEATED',
      capacity: 4,
      seats: seats(['A'], 4, '002'),
    },
    { id: FLOOR_ID, name: 'Floor', type: 'GA', capacity: 50, seats: [] },
  ],
};

/** A standing-only venue no event has released tickets at yet. */
export const adminLoft: AdminVenue = {
  id: '01970000-0000-7000-8000-0000000000a2',
  slug: 'loft-23',
  name: 'Loft 23',
  address: '23 Mill Lane',
  city: 'Shelbyville',
  timezone: 'America/Chicago',
  capacity: 80,
  layoutLocked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  sections: [
    {
      id: '01970000-0000-7000-8000-0000000005b1',
      name: 'Loft',
      type: 'GA',
      capacity: 80,
      seats: [],
    },
  ],
};

export const adminVenues = [adminLoft, adminRiverside];

export function venueSummary(venue: AdminVenue): AdminVenueSummary {
  return { ...venue, sections: venue.sections.map(({ seats: _seats, ...section }) => section) };
}

const counts = (total: number, held = 0, sold = 0): TicketCounts => ({
  total,
  available: total - held - sold,
  held,
  sold,
});

const eventVenue = ({ id, slug, name, city, timezone }: AdminVenue) => ({
  id,
  slug,
  name,
  city,
  timezone,
});

/** A draft with no tickets released: Sat, Jan 9, 2027, 8 PM in New York. */
export const draftEvent: AdminEvent = {
  id: '01970000-0000-7000-8000-0000000000d1',
  slug: 'winter-warmers',
  title: 'Winter Warmers',
  performer: 'The Mittens',
  description: 'Cosy songs for a cold night.',
  category: 'CONCERT',
  status: 'DRAFT',
  venue: eventVenue(adminRiverside),
  startsAt: '2027-01-10T01:00:00.000Z',
  endsAt: '2027-01-10T04:00:00.000Z',
  salesOpenAt: '2026-12-01T15:00:00.000Z',
  holdDurationSec: 600,
  maxTicketsPerOrder: 6,
  waitingRoomEnabled: false,
  admissionRatePerSec: 10,
  admissionTokenTtlSec: 600,
  tickets: counts(0),
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  batches: [],
};

/** On sale: the Stalls and 20 Floor places released, a Balcony batch scheduled. */
export const publishedEvent: AdminEvent = {
  ...draftEvent,
  id: '01970000-0000-7000-8000-0000000000d2',
  slug: 'midnight-echoes-live',
  title: 'Midnight Echoes Live',
  performer: 'Midnight Echoes',
  description: 'A late-night set.',
  status: 'PUBLISHED',
  startsAt: '2026-12-13T04:30:00.000Z',
  endsAt: '2026-12-13T07:00:00.000Z',
  salesOpenAt: '2026-10-23T19:00:00.000Z',
  holdDurationSec: 300,
  maxTicketsPerOrder: 4,
  tickets: counts(30, 2, 5),
  batches: [
    {
      id: '01970000-0000-7000-8000-0000000000b1',
      name: 'Early bird',
      priceCents: 4500,
      releasesAt: '2026-10-23T19:00:00.000Z',
      released: true,
      createdAt: '2026-10-20T10:00:00.000Z',
      tickets: counts(26, 2, 5),
      sections: [
        { sectionId: STALLS_ID, name: 'Stalls', type: 'SEATED', tickets: counts(6, 2, 4) },
        { sectionId: FLOOR_ID, name: 'Floor', type: 'GA', tickets: counts(20, 0, 1) },
      ],
    },
    {
      id: '01970000-0000-7000-8000-0000000000b2',
      name: 'Balcony',
      priceCents: 2500,
      releasesAt: '2026-12-01T15:00:00.000Z',
      released: false,
      createdAt: '2026-10-20T10:00:00.000Z',
      tickets: counts(4),
      sections: [{ sectionId: BALCONY_ID, name: 'Balcony', type: 'SEATED', tickets: counts(4) }],
    },
  ],
};

export const cancelledEvent: AdminEvent = {
  ...draftEvent,
  id: '01970000-0000-7000-8000-0000000000d3',
  slug: 'rained-off',
  title: 'Rained Off',
  status: 'CANCELLED',
  venue: eventVenue(adminLoft),
};

export const adminEvents = [publishedEvent, draftEvent, cancelledEvent];

export function eventSummary(event: AdminEvent): AdminEventSummary {
  const {
    description: _description,
    holdDurationSec: _hold,
    maxTicketsPerOrder: _max,
    waitingRoomEnabled: _waitingRoom,
    admissionRatePerSec: _rate,
    admissionTokenTtlSec: _ttl,
    batches: _batches,
    ...summary
  } = event;
  return summary;
}

export function page<T>(items: T[], { page = 1, pageSize = 20, total = items.length } = {}) {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
