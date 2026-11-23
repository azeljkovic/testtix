import type { StoredEntry } from './queue-store.js';
import type { QueueEntry } from './waiting-room.schemas.js';

/** Shortest `retryAfterMs`, so clients never poll in a tight loop. */
export const MIN_QUEUE_RETRY_MS = 250;

/** The event settings a queue entry's view depends on. */
export interface QueueEventSettings {
  salesOpenAt: Date;
  waitingRoomEnabled: boolean;
  admissionRatePerSec: number;
}

/**
 * What `GET /queue/{token}` shows for a stored entry at `now` (server clock). Pure.
 *
 * The estimate assumes the admission job lets `admissionRatePerSec` customers in at the start of
 * every second from the next batch on (`nextBatchAt`, or at once when none is due yet). With the
 * waiting room turned off, the next run lets everyone in.
 */
export function toQueueEntry(
  entry: StoredEntry,
  event: QueueEventSettings,
  now: Date,
  pollIntervalMs: number,
): QueueEntry {
  const nowMs = now.getTime();
  const openMs = event.salesOpenAt.getTime();
  const base = {
    token: entry.token,
    eventId: entry.eventId,
    joinedAt: entry.joinedAt.toISOString(),
    salesOpenAt: event.salesOpenAt.toISOString(),
    queueLength: entry.waitingCount,
  };
  const idle = { position: null, estimatedWaitMs: null, retryAfterMs: null, admission: null };

  if (entry.admissionExpiresAt !== null) {
    return entry.admissionExpiresAt.getTime() > nowMs
      ? {
          ...base,
          ...idle,
          status: 'ADMITTED',
          admission: {
            token: entry.admissionToken,
            expiresAt: entry.admissionExpiresAt.toISOString(),
          },
        }
      : { ...base, ...idle, status: 'EXPIRED' };
  }
  if (entry.rank === null) {
    throw new Error(`Queue entry ${entry.token} is neither waiting nor admitted`);
  }
  if (nowMs < openMs) {
    return {
      ...base,
      ...idle,
      status: 'PRE_SALE',
      retryAfterMs: clampRetry(openMs - nowMs, pollIntervalMs),
    };
  }

  const position = entry.rank + 1;
  const nextBatchMs = Math.max(entry.nextBatchAt?.getTime() ?? nowMs, openMs);
  const batchesBefore = event.waitingRoomEnabled
    ? Math.ceil(position / event.admissionRatePerSec) - 1
    : 0;
  const estimatedWaitMs = Math.max(0, nextBatchMs - nowMs) + batchesBefore * 1000;
  return {
    ...base,
    status: 'WAITING',
    position,
    estimatedWaitMs,
    retryAfterMs: clampRetry(estimatedWaitMs, pollIntervalMs),
    admission: null,
  };
}

function clampRetry(ms: number, pollIntervalMs: number): number {
  return Math.min(Math.max(ms, MIN_QUEUE_RETRY_MS), pollIntervalMs);
}
