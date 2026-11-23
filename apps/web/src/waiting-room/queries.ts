import { queryOptions } from '@tanstack/react-query';

import { ApiError } from '../api/errors.js';
import { fetchQueueEntry, joinQueue, type QueueEntry } from '../api/waiting-room.js';

/** Query options for your place in ticket drops' waiting rooms. */
export const queueQueries = {
  /**
   * Your entry in the event's waiting room. The first fetch joins the queue (`POST`, which returns
   * an existing entry as it is); later fetches poll that entry's token (`GET`), waiting each
   * response's `retryAfterMs` (null, once `ADMITTED` or `EXPIRED`, stops it). A token that answers
   * 404 (replaced by joining again in another tab) joins again. An `EXPIRED` entry stays as it is:
   * queueing again is the customer's choice (`rejoin()`).
   *
   * Only for a logged-in customer of an event with `waitingRoomEnabled`. A 409 `no-waiting-room`
   * means the event changed: it refetches the catalogue's events, which then say so.
   */
  entry: (eventId: string) =>
    queryOptions({
      queryKey: ['queue', eventId],
      queryFn: async ({ client, queryKey, signal }): Promise<QueueEntry> => {
        const current = client.getQueryData<QueueEntry>(queryKey);
        try {
          if (current === undefined) return await joinQueue(eventId);
          try {
            return await fetchQueueEntry(current.token, signal);
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return await joinQueue(eventId);
            throw error;
          }
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NO_WAITING_ROOM') {
            void client.invalidateQueries({ queryKey: ['catalogue', 'event'] });
          }
          throw error;
        }
      },
      staleTime: 0,
      refetchInterval: (query) => query.state.data?.retryAfterMs ?? false,
    }),
};
