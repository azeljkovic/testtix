import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Incoming IDs are reused only if they are short and safe to write into logs. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reuses a well-formed `X-Request-Id` from the caller (so a test can correlate its own ID with
 * server logs) or generates a UUID, and echoes it back in the response header.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Express middleware that assigns `req.id` before anything else runs, including the body parser,
 * so even a request rejected for malformed JSON has an ID. pino-http keeps an existing `req.id`.
 */
export function requestIdMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  req.id = resolveRequestId(req, res);
  next();
}
