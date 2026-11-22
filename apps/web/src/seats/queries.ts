import { queryOptions } from '@tanstack/react-query';

import { fetchCurrentHold } from '../api/holds.js';
import { fetchSeatMap } from '../api/seats.js';

/** Query options for seat maps (`GET /events/{eventId}/seats`) and holds. */
export const seatQueries = {
  seatMap: (eventId: string) =>
    queryOptions({
      queryKey: ['seats', 'map', eventId],
      queryFn: ({ signal }) => fetchSeatMap(eventId, signal),
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
