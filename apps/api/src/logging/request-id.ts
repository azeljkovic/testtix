import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Incoming IDs are reused only if they are short and safe to write into logs. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Fastify's `genReqId`: reuses a well-formed `X-Request-Id` from the caller (so a test can
 * correlate its own ID with server logs) or generates a UUID. Fastify assigns it before any hook,
 * middleware or body parsing runs, and pino-http logs the same value as `req.id`.
 */
export function requestIdFor(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
}
