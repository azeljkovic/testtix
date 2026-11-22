import type { HoldRequest, SeatStatus, TicketsUnavailableProblem } from '@testtix/shared';

import type {
  SeatMap,
  SeatMapGaSection,
  SeatMapRow,
  SeatMapSeat,
  SeatMapSeatedSection,
} from '../api/seats.js';
import { formatTicketPrice } from '../catalogue/format.js';

/**
 * What the visitor has picked: seat IDs, and a quantity per GA section ID. `holdRequest()` turns
 * its summary into a hold request.
 */
export interface Selection {
  readonly seats: readonly string[];
  readonly ga: Readonly<Record<string, number>>;
}

export const EMPTY_SELECTION: Selection = { seats: [], ga: {} };

/** How a seat is shown: its status on the map, or `SELECTED` when the visitor picked it. */
export type SeatState = SeatStatus | 'SELECTED';

/** Seat states in legend order. */
export const SEAT_STATES: readonly SeatState[] = [
  'AVAILABLE',
  'SELECTED',
  'HELD',
  'SOLD',
  'NOT_ON_SALE',
];

/** The state as the last part of a seat's accessible name. */
export const SEAT_STATE_LABELS: Record<SeatState, string> = {
  AVAILABLE: 'available',
  SELECTED: 'selected',
  HELD: 'held',
  SOLD: 'sold',
  NOT_ON_SALE: 'not on sale',
};

export function seatState(seat: SeatMapSeat, selected: boolean): SeatState {
  return selected && seat.status === 'AVAILABLE' ? 'SELECTED' : seat.status;
}

/** Where a seat is, e.g. "Stalls, row B, seat 12". */
export function seatPlace(sectionName: string, rowLabel: string, seatNumber: number): string {
  return `${sectionName}, row ${rowLabel}, seat ${seatNumber.toString()}`;
}

/** A seat's accessible name, e.g. "Stalls, row B, seat 12, $89.00, available". */
export function seatName(
  sectionName: string,
  rowLabel: string,
  seat: SeatMapSeat,
  state: SeatState,
): string {
  const price = seat.priceCents === null ? '' : `, ${formatTicketPrice(seat.priceCents)}`;
  return `${seatPlace(sectionName, rowLabel, seat.number)}${price}, ${SEAT_STATE_LABELS[state]}`;
}

/**
 * What `quantity` places in a GA section cost: a hold takes the cheapest available places first, so
 * this walks the price tiers from the cheapest.
 */
export function gaCost(prices: SeatMapGaSection['prices'], quantity: number): number {
  let left = quantity;
  let cents = 0;
  for (const tier of prices) {
    const taken = Math.min(left, tier.available);
    cents += taken * tier.priceCents;
    left -= taken;
    if (left === 0) break;
  }
  return cents;
}

export interface SelectedSeat {
  section: SeatMapSeatedSection;
  row: SeatMapRow;
  seat: SeatMapSeat;
}

export interface SelectedGa {
  section: SeatMapGaSection;
  quantity: number;
  cents: number;
}

/** A selection checked against the current seat map, in the venue's order. */
export interface SelectionSummary {
  seats: SelectedSeat[];
  ga: SelectedGa[];
  /** Seats plus GA places. */
  count: number;
  totalCents: number;
}

/**
 * The part of `selection` that can still be held on `map`: seats that are still available (in venue,
 * row and seat order), and GA quantities capped at the places left.
 */
export function summarize(map: SeatMap, selection: Selection): SelectionSummary {
  const picked = new Set(selection.seats);
  const seats: SelectedSeat[] = [];
  const ga: SelectedGa[] = [];
  for (const section of map.sections) {
    if (section.type === 'SEATED') {
      for (const row of section.rows) {
        for (const seat of row.seats) {
          if (picked.has(seat.id) && seat.status === 'AVAILABLE')
            seats.push({ section, row, seat });
        }
      }
    } else {
      const quantity = Math.min(selection.ga[section.id] ?? 0, section.available);
      if (quantity > 0) ga.push({ section, quantity, cents: gaCost(section.prices, quantity) });
    }
  }
  const seatCents = seats.reduce((sum, { seat }) => sum + (seat.priceCents ?? 0), 0);
  return {
    seats,
    ga,
    count: seats.length + ga.reduce((sum, item) => sum + item.quantity, 0),
    totalCents: seatCents + ga.reduce((sum, item) => sum + item.cents, 0),
  };
}

/**
 * `selection` without what `map` no longer allows (seats taken by someone else, GA places beyond
 * what's left). Returns `selection` itself when nothing changed.
 */
export function pruneSelection(map: SeatMap, selection: Selection): Selection {
  const summary = summarize(map, selection);
  const seats = summary.seats.map(({ seat }) => seat.id);
  const ga = Object.fromEntries(summary.ga.map(({ section, quantity }) => [section.id, quantity]));
  const unchanged =
    seats.length === selection.seats.length &&
    Object.keys(selection.ga).every((id) => selection.ga[id] === (ga[id] ?? 0));
  return unchanged ? selection : { seats, ga };
}

/** The hold request for what `summary` says can be held. */
export function holdRequest(summary: SelectionSummary): HoldRequest {
  return {
    seats: summary.seats.map(({ seat }) => seat.id),
    ga: summary.ga.map(({ section, quantity }) => ({ sectionId: section.id, quantity })),
  };
}

/**
 * What a 409 `tickets-unavailable` took away, in words, using the map the request was made from:
 * "Stalls, row A, seat 3" per seat, and "Loft: 1 left (you asked for 3)" per GA section.
 */
export function unavailableTickets(
  map: SeatMap,
  problem: Pick<TicketsUnavailableProblem, 'unavailableSeatIds' | 'gaShortfalls'>,
): string[] {
  const places = new Map<string, string>();
  const gaNames = new Map<string, string>();
  for (const section of map.sections) {
    if (section.type === 'GA') {
      gaNames.set(section.id, section.name);
      continue;
    }
    for (const row of section.rows) {
      for (const seat of row.seats) {
        places.set(seat.id, seatPlace(section.name, row.label, seat.number));
      }
    }
  }
  return [
    ...problem.unavailableSeatIds.map((id) => places.get(id) ?? 'A seat you chose'),
    ...problem.gaShortfalls.map(({ sectionId, requested, available }) => {
      const name = gaNames.get(sectionId) ?? 'General admission';
      const left = available === 0 ? 'none left' : `${available.toString()} left`;
      return `${name}: ${left} (you asked for ${requested.toString()})`;
    }),
  ];
}
