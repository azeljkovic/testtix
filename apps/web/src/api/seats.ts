import { api } from './client.js';
import { unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type SeatMap = components['schemas']['SeatMap_Output'];
export type SeatMapSection = SeatMap['sections'][number];
export type SeatMapSeatedSection = components['schemas']['SeatMapSeatedSection_Output'];
export type SeatMapGaSection = components['schemas']['SeatMapGaSection_Output'];
export type SeatMapRow = components['schemas']['SeatMapRow_Output'];
export type SeatMapSeat = components['schemas']['SeatMapSeat_Output'];

/** `GET /events/{eventId}/seats`: every section of the event's venue, with seat statuses and GA places. */
export async function fetchSeatMap(eventId: string, signal?: AbortSignal): Promise<SeatMap> {
  return unwrap(
    await api.GET('/events/{eventId}/seats', { params: { path: { eventId } }, signal }),
  );
}
