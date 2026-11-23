import { z } from 'zod';

/**
 * Where a customer is in a ticket drop's waiting room (C5.1):
 *
 * - `PRE_SALE`: joined before sales open. Everyone who joins before then is let in in a random
 *   order once sales open, so there is no position yet.
 * - `WAITING`: sales are open; waiting for a turn at `position`.
 * - `ADMITTED`: let in. The admission token opens the seat map and holds until it expires.
 * - `EXPIRED`: the admission ran out. Joining again puts the customer at the back of the queue.
 */
export const QUEUE_STATUSES = ['PRE_SALE', 'WAITING', 'ADMITTED', 'EXPIRED'] as const;

export const QueueStatusSchema = z.enum(QUEUE_STATUSES).meta({ id: 'QueueStatus' });

export type QueueStatus = z.infer<typeof QueueStatusSchema>;

/** Statuses a queue entry never leaves. Clients stop polling once they reach one. */
export const FINAL_QUEUE_STATUSES = [
  'ADMITTED',
  'EXPIRED',
] as const satisfies readonly QueueStatus[];

/**
 * Request header carrying the admission token, for the seat map and holds of an event with a
 * waiting room.
 */
export const ADMISSION_TOKEN_HEADER = 'X-Admission-Token';
