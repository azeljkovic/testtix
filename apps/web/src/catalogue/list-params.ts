import {
  CATALOGUE_SEARCH_MAX_LENGTH,
  type CatalogueSort,
  CatalogueSortSchema,
  type EventAvailability,
  EventAvailabilitySchema,
  type EventCategory,
  EventCategorySchema,
  type EventSeating,
  EventSeatingSchema,
  PAGE_SIZE_DEFAULT,
  SORT_ORDERS,
} from '@testtix/shared';

import type { EventListQuery } from '../api/catalogue.js';

export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * The state of the event list page. It all lives in the URL query (`/events?category=TALK&page=2`),
 * so a list is shareable and the back button restores it. Parameter names and values are the ones
 * `GET /events` takes, except `from` / `to`, which are calendar days (`2026-12-01`).
 */
export interface EventListParams {
  /** Search text, trimmed; empty for no search. */
  q: string;
  category?: EventCategory;
  /** Venue slug. */
  venue?: string;
  seating?: EventSeating;
  availability?: EventAvailability;
  /** First day (`YYYY-MM-DD`, the browser's time zone) of the date range. */
  from?: string;
  /** Last day (`YYYY-MM-DD`, included) of the date range. */
  to?: string;
  sort: CatalogueSort;
  order: SortOrder;
  page: number;
}

/** Events per page. */
export const EVENT_PAGE_SIZE = PAGE_SIZE_DEFAULT;

export const DEFAULT_LIST_PARAMS: EventListParams = { q: '', sort: 'date', order: 'asc', page: 1 };

/** The filters a visitor can clear (everything but sort and page). */
const FILTER_KEYS = ['q', 'category', 'venue', 'seating', 'availability', 'from', 'to'] as const;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads the list state from a URL query. A value the API wouldn't accept (an unknown category, a
 * page of 0, a malformed date) is ignored, as if the parameter weren't there.
 */
export function parseListParams(search: URLSearchParams): EventListParams {
  const value = (key: string) => search.get(key)?.trim() ?? '';
  const order = value('order');
  const page = Number(value('page'));
  const venue = value('venue');

  return {
    q: value('q').slice(0, CATALOGUE_SEARCH_MAX_LENGTH),
    category: EventCategorySchema.safeParse(value('category')).data,
    venue: venue !== '' && venue.length <= 100 ? venue : undefined,
    seating: EventSeatingSchema.safeParse(value('seating')).data,
    availability: EventAvailabilitySchema.safeParse(value('availability')).data,
    from: parseDay(value('from')) === undefined ? undefined : value('from'),
    to: parseDay(value('to')) === undefined ? undefined : value('to'),
    sort: CatalogueSortSchema.safeParse(value('sort')).data ?? DEFAULT_LIST_PARAMS.sort,
    order: (SORT_ORDERS as readonly string[]).includes(order)
      ? (order as SortOrder)
      : DEFAULT_LIST_PARAMS.order,
    page: Number.isSafeInteger(page) && page >= 1 ? page : DEFAULT_LIST_PARAMS.page,
  };
}

/** The URL query for a list state. Defaults are left out, so the plain list is just `/events`. */
export function toSearchParams(params: EventListParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (value !== undefined && value !== '') search.set(key, value);
  }
  if (params.sort !== DEFAULT_LIST_PARAMS.sort) search.set('sort', params.sort);
  if (params.order !== DEFAULT_LIST_PARAMS.order) search.set('order', params.order);
  if (params.page !== DEFAULT_LIST_PARAMS.page) search.set('page', String(params.page));
  return search;
}

/**
 * The `GET /events` query for a list state. The days become the start of `from` and the end of
 * `to` in the browser's time zone. Without `from` the API starts at its own "now".
 */
export function toApiQuery(params: EventListParams): EventListQuery {
  const query: EventListQuery = {
    sort: params.sort,
    order: params.order,
    page: params.page,
    pageSize: EVENT_PAGE_SIZE,
  };
  if (params.q !== '') query.q = params.q;
  if (params.category) query.category = params.category;
  if (params.venue !== undefined) query.venue = params.venue;
  if (params.seating) query.seating = params.seating;
  if (params.availability) query.availability = params.availability;
  const from = params.from === undefined ? undefined : parseDay(params.from);
  const to = params.to === undefined ? undefined : parseDay(params.to);
  if (from) query.from = from.toISOString();
  // The day after `to`, at midnight: the API's `to` is exclusive.
  if (to) query.to = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString();
  return query;
}

export const DATE_RANGE_MESSAGE = 'The “To” date can’t be before the “From” date';

/** Why the date range can't be searched, or `undefined` when it can. */
export function dateRangeError({ from, to }: EventListParams): string | undefined {
  // Same-length ISO days compare correctly as strings.
  return from !== undefined && to !== undefined && to < from ? DATE_RANGE_MESSAGE : undefined;
}

export function hasFilters(params: EventListParams): boolean {
  return FILTER_KEYS.some((key) => params[key] !== undefined && params[key] !== '');
}

/** Midnight of a `YYYY-MM-DD` day in the browser's time zone, or `undefined` if it isn't a real day. */
function parseDay(day: string): Date | undefined {
  const match = DAY_PATTERN.exec(day);
  if (!match) return undefined;
  const [year, month, date] = match.slice(1).map(Number) as [number, number, number];
  const parsed = new Date(year, month - 1, date);
  // `new Date` rolls invalid days over (Feb 30 → Mar 2); a real day round-trips.
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === date
    ? parsed
    : undefined;
}
