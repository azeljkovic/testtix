import { queryOptions } from '@tanstack/react-query';

import { fetchSeatMap } from '../api/seats.js';

/** Query options for seat maps (`GET /events/{eventId}/seats`). */
export const seatQueries = {
  seatMap: (eventId: string) =>
    queryOptions({
      queryKey: ['seats', 'map', eventId],
      queryFn: ({ signal }) => fetchSeatMap(eventId, signal),
      // Seats change hands all the time: always refetch on mount and when the window regains focus.
      staleTime: 0,
    }),
};
