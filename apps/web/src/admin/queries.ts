import { PAGE_SIZE_MAX } from '@testtix/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import {
  type AdminEvent,
  type AdminEventListQuery,
  type AdminVenueListQuery,
  fetchAdminEvent,
  fetchAdminEvents,
  fetchAdminVenue,
  fetchAdminVenues,
} from '../api/admin.js';

/** Query options for the admin API (`/admin/events`, `/admin/venues`). */
export const adminQueries = {
  events: (query: AdminEventListQuery) =>
    queryOptions({
      queryKey: ['admin', 'events', 'list', query],
      queryFn: ({ signal }) => fetchAdminEvents(query, signal),
    }),
  event: (eventId: string) =>
    queryOptions({
      queryKey: ['admin', 'events', 'detail', eventId],
      queryFn: ({ signal }) => fetchAdminEvent(eventId, signal),
    }),
  venues: (query: AdminVenueListQuery) =>
    queryOptions({
      queryKey: ['admin', 'venues', 'list', query],
      queryFn: ({ signal }) => fetchAdminVenues(query, signal),
    }),
  /** The venue choices of the event form: the first `PAGE_SIZE_MAX` venues by name. */
  venueOptions: () =>
    queryOptions({
      queryKey: ['admin', 'venues', 'list', { pageSize: PAGE_SIZE_MAX }],
      queryFn: async ({ signal }) =>
        (await fetchAdminVenues({ pageSize: PAGE_SIZE_MAX }, signal)).items,
    }),
  venue: (venueId: string) =>
    queryOptions({
      queryKey: ['admin', 'venues', 'detail', venueId],
      queryFn: ({ signal }) => fetchAdminVenue(venueId, signal),
    }),
};

/**
 * After an event changed: caches the new version and marks the lists (admin and public) stale, so
 * they show the change when next viewed.
 */
export async function eventChanged(queryClient: QueryClient, event?: AdminEvent): Promise<void> {
  if (event !== undefined) queryClient.setQueryData(adminQueries.event(event.id).queryKey, event);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin', 'events', 'list'] }),
    queryClient.invalidateQueries({ queryKey: ['catalogue'] }),
  ]);
}

/** After a venue changed: venue lists and events (which show the venue) are stale. */
export async function venueChanged(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin'] }),
    queryClient.invalidateQueries({ queryKey: ['catalogue'] }),
  ]);
}
