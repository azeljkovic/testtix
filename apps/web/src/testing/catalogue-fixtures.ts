import type { Schemas } from './msw-server.js';

type EventSummary = Schemas['CatalogueEventSummary_Output'];
type EventDetail = Schemas['CatalogueEvent_Output'];
type Venue = Schemas['CatalogueVenue_Output'];

/** Catalogue data for component tests. Times are UTC; the venues are in New York (EST in winter). */
export const riversideHall: Venue = {
  id: '01970000-0000-7000-8000-0000000000a1',
  slug: 'riverside-hall',
  name: 'Riverside Hall',
  city: 'Springfield',
  timezone: 'America/New_York',
};

export const loft23: Venue = {
  id: '01970000-0000-7000-8000-0000000000a2',
  slug: 'loft-23',
  name: 'Loft 23',
  city: 'Springfield',
  timezone: 'America/New_York',
};

/** Seated concert on sale: Sat, Dec 12, 2026, 11:30 PM EST. */
export const concert: EventSummary = {
  id: '01970000-0000-7000-8000-0000000000e1',
  slug: 'midnight-echoes-live',
  title: 'Midnight Echoes Live',
  performer: 'Midnight Echoes',
  category: 'CONCERT',
  venue: riversideHall,
  startsAt: '2026-12-13T04:30:00.000Z',
  endsAt: '2026-12-13T07:00:00.000Z',
  salesOpenAt: '2026-10-23T19:00:00.000Z',
  seating: 'SEATED',
  availability: 'ON_SALE',
  availableTickets: 180,
  priceRange: { minCents: 5900, maxCents: 8900 },
};

/** GA meetup on sale, one price. */
export const meetup: EventSummary = {
  id: '01970000-0000-7000-8000-0000000000e2',
  slug: 'flaky-tests-clinic',
  title: 'Flaky Tests Clinic',
  performer: 'Testing Guild',
  category: 'MEETUP',
  venue: loft23,
  startsAt: '2026-11-30T00:00:00.000Z',
  endsAt: '2026-11-30T02:00:00.000Z',
  salesOpenAt: '2026-10-23T19:00:00.000Z',
  seating: 'GA',
  availability: 'ON_SALE',
  availableTickets: 60,
  priceRange: { minCents: 1000, maxCents: 1000 },
};

/** Not on sale yet. */
export const preview: EventSummary = {
  ...concert,
  id: '01970000-0000-7000-8000-0000000000e3',
  slug: 'summer-sounds-preview',
  title: 'Summer Sounds Preview',
  performer: 'Various artists',
  startsAt: '2027-01-22T04:00:00.000Z',
  endsAt: '2027-01-22T06:00:00.000Z',
  salesOpenAt: '2026-12-06T20:00:00.000Z',
  availability: 'SALES_NOT_OPEN',
  availableTickets: 0,
  priceRange: { minCents: 0, maxCents: 2500 },
};

export const catalogueEvents = [meetup, concert, preview];

export const catalogueVenues = [loft23, riversideHall];

/** The concert's page: Stalls on sale, the Balcony released later. */
export const concertDetail: EventDetail = {
  ...concert,
  venue: { ...riversideHall, address: '1 River Road' },
  description: 'A late-night set.\nDoors open at 11 PM.',
  maxTicketsPerOrder: 6,
  waitingRoomEnabled: false,
  tickets: { total: 200, available: 180, held: 5, sold: 15 },
  sections: [
    {
      id: '01970000-0000-7000-8000-0000000000b1',
      name: 'Stalls',
      type: 'SEATED',
      tickets: { total: 200, available: 180, held: 5, sold: 15 },
      priceRange: { minCents: 8900, maxCents: 8900 },
      nextReleaseAt: null,
    },
    {
      id: '01970000-0000-7000-8000-0000000000b2',
      name: 'Balcony',
      type: 'SEATED',
      tickets: { total: 0, available: 0, held: 0, sold: 0 },
      priceRange: { minCents: 5900, maxCents: 5900 },
      // Wed, Nov 25, 2026, 3:00 PM EST.
      nextReleaseAt: '2026-11-25T20:00:00.000Z',
    },
  ],
};

/** The meetup's page: one GA section. */
export const meetupDetail: EventDetail = {
  ...meetup,
  venue: { ...loft23, address: '23 Mill Street' },
  description: 'Bring your flakiest test.',
  maxTicketsPerOrder: 4,
  waitingRoomEnabled: false,
  tickets: { total: 60, available: 60, held: 0, sold: 0 },
  sections: [
    {
      id: '01970000-0000-7000-8000-0000000000b3',
      name: 'Loft',
      type: 'GA',
      tickets: { total: 60, available: 60, held: 0, sold: 0 },
      priceRange: { minCents: 1000, maxCents: 1000 },
      nextReleaseAt: null,
    },
  ],
};

/** Seated and standing event on sale: a Mezzanine and a Standing Floor. */
export const mixedDetail: EventDetail = {
  ...concertDetail,
  id: '01970000-0000-7000-8000-0000000000e4',
  slug: 'harbour-lights',
  title: 'Harbour Lights',
  performer: 'The Harbour Lights',
  venue: { ...loft23, address: '23 Mill Street' },
  seating: 'MIXED',
  maxTicketsPerOrder: 6,
  priceRange: { minCents: 2500, maxCents: 4500 },
  availableTickets: 46,
  tickets: { total: 48, available: 46, held: 0, sold: 2 },
  sections: [
    {
      id: '01970000-0000-7000-8000-0000000000b5',
      name: 'Mezzanine',
      type: 'SEATED',
      tickets: { total: 8, available: 6, held: 0, sold: 2 },
      priceRange: { minCents: 4500, maxCents: 4500 },
      nextReleaseAt: null,
    },
    {
      id: '01970000-0000-7000-8000-0000000000b6',
      name: 'Standing Floor',
      type: 'GA',
      tickets: { total: 40, available: 40, held: 0, sold: 0 },
      priceRange: { minCents: 2500, maxCents: 2500 },
      nextReleaseAt: null,
    },
  ],
};

/**
 * A ticket drop on sale (`waitingRoomEnabled`): the concert's venue and sections, but its seat map
 * and holds need an admission from the waiting room. Thu, Dec 31, 2026, 10:00 PM EST.
 */
export const dropDetail: EventDetail = {
  ...concertDetail,
  id: '01970000-0000-7000-8000-0000000000e5',
  slug: 'new-year-drop',
  title: 'New Year Drop',
  performer: 'The Countdown',
  startsAt: '2027-01-01T03:00:00.000Z',
  endsAt: '2027-01-01T06:00:00.000Z',
  waitingRoomEnabled: true,
};

export const catalogueEventDetails = [concertDetail, meetupDetail, mixedDetail, dropDetail];

/** A `GET /events` response with `items` as one page of `total` events. */
export function eventPage(
  items: EventSummary[],
  {
    page = 1,
    pageSize = 20,
    total = items.length,
  }: { page?: number; pageSize?: number; total?: number } = {},
): Schemas['CatalogueEventPage_Output'] {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
