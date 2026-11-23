import { api, csrfHeader } from './client.js';
import { unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type QueueEntry = components['schemas']['QueueEntry_Output'];

/**
 * `POST /events/{eventId}/queue`: joins a ticket drop's waiting room, or returns your current entry
 * (while you wait or are admitted). Once an admission has expired, it queues you again at the back.
 */
export async function joinQueue(eventId: string): Promise<QueueEntry> {
  return unwrap(
    await api.POST('/events/{eventId}/queue', {
      params: { path: { eventId }, header: await csrfHeader() },
    }),
  );
}

/** `GET /queue/{token}`: your place in the queue. Poll it after `retryAfterMs` until that is null. */
export async function fetchQueueEntry(token: string, signal?: AbortSignal): Promise<QueueEntry> {
  return unwrap(await api.GET('/queue/{token}', { params: { path: { token } }, signal }));
}
