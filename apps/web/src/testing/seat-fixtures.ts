import type { SeatStatus } from '@testtix/shared';

import { concert, dropDetail, meetup, mixedDetail } from './catalogue-fixtures.js';
import type { Schemas } from './msw-server.js';

type SeatMap = Schemas['SeatMap_Output'];
type SeatedSection = Schemas['SeatMapSeatedSection_Output'];

const STATUS_CODES: Record<string, SeatStatus> = {
  A: 'AVAILABLE',
  H: 'HELD',
  S: 'SOLD',
  N: 'NOT_ON_SALE',
};

/**
 * A seated section from one status string per row, front row first: `A` available, `H` held, `S`
 * sold, `N` not on sale. Seat IDs are `…-0005<section><row><seat>` in hex, e.g. section 1, row B,
 * seat 3 is `01970000-0000-7000-8000-000501010003`. `unpriced` statuses have no price (no batch
 * includes the seat); every other seat costs `priceCents`.
 */
function seatedSection(
  section: { id: string; name: string; number: number },
  rows: string[],
  priceCents: number,
  unpriced = false,
): SeatedSection {
  const sectionRows = rows.map((codes, index) => {
    const label = String.fromCharCode(65 + index);
    return {
      label,
      index,
      seats: Array.from(codes, (code, seat) => {
        const status = STATUS_CODES[code] ?? 'NOT_ON_SALE';
        return {
          id: fixtureSeatId(section.number, label, seat + 1),
          number: seat + 1,
          status,
          priceCents: unpriced && status === 'NOT_ON_SALE' ? null : priceCents,
        };
      }),
    };
  });
  return {
    id: section.id,
    name: section.name,
    type: 'SEATED',
    available: rows.join('').split('A').length - 1,
    rows: sectionRows,
  };
}

/** The seat ID `seatedSection()` gives section `section`, row `row` (`'A'`, …), seat `seat`. */
export function fixtureSeatId(section: number, row: string, seat: number): string {
  const hex = (value: number, width: number) => value.toString(16).padStart(width, '0');
  return `01970000-0000-7000-8000-0005${hex(section, 2)}${hex(row.charCodeAt(0) - 65, 2)}${hex(seat, 4)}`;
}

/**
 * The concert's seat map. Stalls (section 1, $89.00) row A: sold, sold, available, available, held;
 * row B: all available; row C: three available, then two not on sale (no price). The Balcony
 * (section 2) is released later, so its seats are priced but not on sale. The Boxes (section 3)
 * are part of the venue only: the event doesn't sell them, so the page leaves them out.
 */
export const concertSeatMap: SeatMap = {
  eventId: concert.id,
  availability: 'ON_SALE',
  maxTicketsPerOrder: 6,
  holdDurationSec: 600,
  sections: [
    seatedSection(
      { id: '01970000-0000-7000-8000-0000000000b1', name: 'Stalls', number: 1 },
      ['SSAAH', 'AAAAA', 'AAANN'],
      8900,
      true,
    ),
    seatedSection(
      { id: '01970000-0000-7000-8000-0000000000b2', name: 'Balcony', number: 2 },
      ['NNNN', 'NNNN'],
      5900,
    ),
    seatedSection(
      { id: '01970000-0000-7000-8000-0000000000b4', name: 'Boxes', number: 3 },
      ['NN'],
      0,
      true,
    ),
  ],
};

/** The meetup's seat map: the Loft (GA) has 3 places left, 2 at $10.00 and 1 at $15.00. */
export const meetupSeatMap: SeatMap = {
  eventId: meetup.id,
  availability: 'ON_SALE',
  maxTicketsPerOrder: 4,
  holdDurationSec: 600,
  sections: [
    {
      id: '01970000-0000-7000-8000-0000000000b3',
      name: 'Loft',
      type: 'GA',
      capacity: 60,
      available: 3,
      prices: [
        { priceCents: 1000, available: 2 },
        { priceCents: 1500, available: 1 },
      ],
    },
  ],
};

/** The mixed event's seat map: the Mezzanine (section 5, $45.00) and a Standing Floor at $25.00. */
export const mixedSeatMap: SeatMap = {
  eventId: mixedDetail.id,
  availability: 'ON_SALE',
  maxTicketsPerOrder: 6,
  holdDurationSec: 600,
  sections: [
    seatedSection(
      { id: '01970000-0000-7000-8000-0000000000b5', name: 'Mezzanine', number: 5 },
      ['SAAA', 'AAAS'],
      4500,
    ),
    {
      id: '01970000-0000-7000-8000-0000000000b6',
      name: 'Standing Floor',
      type: 'GA',
      capacity: 40,
      available: 40,
      prices: [{ priceCents: 2500, available: 40 }],
    },
  ],
};

/** The admission token MSW's ticket drop seat map (`dropSeatMap`) accepts. */
export const FIXTURE_ADMISSION_TOKEN = 'fixture-admission-token';

/**
 * The ticket drop's seat map: the concert's. MSW only serves it with the admission token
 * `FIXTURE_ADMISSION_TOKEN`, else 403 `queue-required`.
 */
export const dropSeatMap: SeatMap = { ...concertSeatMap, eventId: dropDetail.id };

export const seatMaps = [concertSeatMap, meetupSeatMap, mixedSeatMap, dropSeatMap];
