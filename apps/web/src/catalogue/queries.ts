import { queryOptions } from '@tanstack/react-query';

import { type EventListQuery, fetchEvent, fetchEvents, fetchVenues } from '../api/catalogue.js';

/** Query options for the public catalogue (`GET /events`, `GET /events/{slug}`, `GET /venues`). */
export const catalogueQueries = {
  events: (query: EventListQuery) =>
    queryOptions({
      queryKey: ['catalogue', 'events', query],
      queryFn: ({ signal }) => fetchEvents(query, signal),
    }),
  event: (slug: string) =>
    queryOptions({
      queryKey: ['catalogue', 'event', slug],
      queryFn: ({ signal }) => fetchEvent(slug, signal),
    }),
  venues: () =>
    queryOptions({
      queryKey: ['catalogue', 'venues'],
      queryFn: ({ signal }) => fetchVenues(signal),
    }),
};
