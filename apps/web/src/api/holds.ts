import {
  type HoldRequest,
  type TicketsUnavailableProblem,
  TicketsUnavailableProblemSchema,
} from '@testtix/shared';

import { api, csrfHeader } from './client.js';
import { ApiError, unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type Hold = components['schemas']['Hold_Output'];
export type HoldItem = components['schemas']['HoldItem_Output'];

/** `GET /holds/current?eventId=…`: your unexpired hold for the event, or `null` when there is none. */
export async function fetchCurrentHold(
  eventId: string,
  signal?: AbortSignal,
): Promise<Hold | null> {
  const result = await api.GET('/holds/current', { params: { query: { eventId } }, signal });
  if (result.response.status === 404) return null;
  return unwrap(result);
}

/**
 * `POST /events/{eventId}/holds`: holds every requested ticket or none, replacing your previous hold
 * for the event. A 409 `tickets-unavailable` says what was taken: read it with `ticketsUnavailable()`.
 */
export async function createHold(eventId: string, body: HoldRequest): Promise<Hold> {
  return unwrap(
    await api.POST('/events/{eventId}/holds', {
      params: { path: { eventId }, header: await csrfHeader() },
      body,
    }),
  );
}

/** `DELETE /holds/{holdId}`. A hold that is already gone (404: released elsewhere, swept) counts as released. */
export async function releaseHold(holdId: string): Promise<void> {
  const result = await api.DELETE('/holds/{holdId}', {
    params: { path: { holdId }, header: await csrfHeader() },
  });
  if (result.response.status === 404) return;
  unwrap(result);
}

/** What a failed hold couldn't get, when `error` is a 409 `tickets-unavailable`. */
export function ticketsUnavailable(error: unknown): TicketsUnavailableProblem | undefined {
  if (!(error instanceof ApiError) || error.code !== 'TICKETS_UNAVAILABLE') return undefined;
  const parsed = TicketsUnavailableProblemSchema.safeParse(error.body);
  return parsed.success ? parsed.data : undefined;
}
