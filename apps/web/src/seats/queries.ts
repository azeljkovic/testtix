import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { ApiError } from '../api/errors.js';
import { fetchCurrentHold } from '../api/holds.js';
import { fetchSeatMap } from '../api/seats.js';
import { queueQueries } from '../waiting-room/queries.js';

/** The key of every seat map query of the event, whatever the admission token: for invalidation. */
const seatMapKey = (eventId: string) => ['seats', 'map', eventId] as const;

/** Query options for seat maps (`GET /events/{eventId}/seats`) and holds. */
export const seatQueries = {
  seatMapKey,
  /**
   * `admissionToken`: from the waiting room of a ticket drop; null for other events. A 403
   * `queue-required` first checks the event (it may have become a drop) and your queue entry again
   * (`recheckAdmission()`), so the page knows where to go by the time the query fails.
   */
  seatMap: (eventId: string, admissionToken: string | null) =>
    queryOptions({
      queryKey: [...seatMapKey(eventId), admissionToken],
      queryFn: async ({ client, signal }) => {
        try {
          return await fetchSeatMap(eventId, admissionToken, signal);
        } catch (error) {
          if (isQueueRequired(error)) await recheckAdmission(client, eventId);
          throw error;
        }
      },
      // Seats change hands all the time: always refetch on mount and when the window regains focus.
      staleTime: 0,
    }),
  /** Your active hold for the event (`null` when there is none); only for a logged-in user. */
  currentHold: (eventId: string) =>
    queryOptions({
      queryKey: ['seats', 'hold', eventId],
      queryFn: ({ signal }) => fetchCurrentHold(eventId, signal),
      // Another tab may have released or replaced it.
      staleTime: 0,
    }),
};

/** A 403 `queue-required`: a ticket drop's seat map or hold without a valid admission. */
export function isQueueRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'QUEUE_REQUIRED';
}

/**
 * Refetches the catalogue's events and your queue entry for `eventId` after a 403
 * `queue-required`: the event may have become a drop, or your admission ended. Resolves once both
 * are back, so `useAdmission()` then sends you to the waiting room.
 */
export async function recheckAdmission(client: QueryClient, eventId: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['catalogue', 'event'] }),
    client.invalidateQueries({ queryKey: queueQueries.entry(eventId).queryKey }),
  ]);
}
