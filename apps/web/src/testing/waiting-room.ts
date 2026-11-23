import { ADMISSION_TOKEN_HEADER, type QueueStatus } from '@testtix/shared';
import { http, HttpResponse } from 'msw';

import { mockAdminRequest, type RecordedRequest } from './admin.js';
import { type Schemas, server } from './msw-server.js';
import { FIXTURE_ADMISSION_TOKEN } from './seat-fixtures.js';

type QueueEntry = Schemas['QueueEntry_Output'];
type CatalogueEvent = Schemas['CatalogueEvent_Output'];

export { FIXTURE_ADMISSION_TOKEN };

export const FIXTURE_QUEUE_TOKEN = 'fixture-queue-token';

interface QueueEntryOptions {
  status?: QueueStatus;
  token?: string;
  /** Defaults to 5 while `WAITING`, else null (as the API sends). */
  position?: number | null;
  queueLength?: number;
  /** Defaults to 1000 ms per place ahead while `WAITING`, else null. */
  estimatedWaitMs?: number | null;
  /** Defaults to 2000 while the entry can change (`PRE_SALE`, `WAITING`), else null. */
  retryAfterMs?: number | null;
  /** When an `ADMITTED` entry's admission ends: defaults to 10 minutes after `Date.now()`. */
  admissionExpiresAt?: number;
  /** Defaults to the event's. */
  salesOpenAt?: string;
}

/** A queue entry as `POST /events/{eventId}/queue` and `GET /queue/{token}` return it. */
export function queueEntryOf(
  event: CatalogueEvent,
  {
    status = 'WAITING',
    token = FIXTURE_QUEUE_TOKEN,
    position = status === 'WAITING' ? 5 : null,
    queueLength = 40,
    estimatedWaitMs = position === null ? null : position * 1000,
    retryAfterMs = status === 'PRE_SALE' || status === 'WAITING' ? 2000 : null,
    admissionExpiresAt = Date.now() + 600_000,
    salesOpenAt = event.salesOpenAt,
  }: QueueEntryOptions = {},
): QueueEntry {
  return {
    token,
    eventId: event.id,
    status,
    joinedAt: new Date(Date.now() - 60_000).toISOString(),
    salesOpenAt,
    position,
    queueLength,
    estimatedWaitMs,
    retryAfterMs,
    admission:
      status === 'ADMITTED'
        ? { token: FIXTURE_ADMISSION_TOKEN, expiresAt: new Date(admissionExpiresAt).toISOString() }
        : null,
  };
}

/**
 * Answers `POST /api/events/{eventId}/queue` with the answers in turn, repeating the last one: an
 * entry (201; the web app treats 200 the same) or a `Response`. Records each request.
 */
export function mockJoinQueue(
  eventId: string,
  ...answers: (QueueEntry | Response)[]
): RecordedRequest[] {
  const requests = mockAdminRequest('post', `/api/events/${eventId}/queue`, () => {
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (answer === undefined) throw new Error('mockJoinQueue() needs an answer');
    return answer instanceof Response ? answer.clone() : answer;
  });
  return requests;
}

/**
 * Answers `GET /api/queue/{token}` with the answers in turn, repeating the last one: an entry, or a
 * `Response`. Returns the times each request arrived (`Date.now()`, the fake clock in tests that
 * fake it).
 */
export function mockQueueEntry(token: string, ...answers: (QueueEntry | Response)[]): number[] {
  const requestedAt: number[] = [];
  server.use(
    http.get(`/api/queue/${token}`, () => {
      const answer = answers[Math.min(requestedAt.length, answers.length - 1)];
      requestedAt.push(Date.now());
      if (answer === undefined) throw new Error('mockQueueEntry() needs an answer');
      return answer instanceof Response ? answer.clone() : HttpResponse.json(answer);
    }),
  );
  return requestedAt;
}

/** The admission token a recorded request sent (`X-Admission-Token`), or null. */
export function admissionTokenOf(request: { headers: Headers }): string | null {
  return request.headers.get(ADMISSION_TOKEN_HEADER);
}
