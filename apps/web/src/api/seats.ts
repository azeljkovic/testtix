import { ADMISSION_TOKEN_HEADER } from '@testtix/shared';

import { api } from './client.js';
import { unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type SeatMap = components['schemas']['SeatMap_Output'];
export type SeatMapSection = SeatMap['sections'][number];
export type SeatMapSeatedSection = components['schemas']['SeatMapSeatedSection_Output'];
export type SeatMapGaSection = components['schemas']['SeatMapGaSection_Output'];
export type SeatMapRow = components['schemas']['SeatMapRow_Output'];
export type SeatMapSeat = components['schemas']['SeatMapSeat_Output'];

/**
 * `GET /events/{eventId}/seats`: every section of the event's venue, with seat statuses and GA
 * places. A ticket drop's map needs your admission token from its waiting room (else 403
 * `queue-required`).
 */
export async function fetchSeatMap(
  eventId: string,
  admissionToken: string | null,
  signal?: AbortSignal,
): Promise<SeatMap> {
  return unwrap(
    await api.GET('/events/{eventId}/seats', {
      params: { path: { eventId }, header: admissionHeader(admissionToken) },
      signal,
    }),
  );
}

/** The `X-Admission-Token` header for a ticket drop's seat map and holds; none without a token. */
export function admissionHeader(admissionToken: string | null): {
  [ADMISSION_TOKEN_HEADER]?: string;
} {
  return admissionToken === null ? {} : { [ADMISSION_TOKEN_HEADER]: admissionToken };
}
