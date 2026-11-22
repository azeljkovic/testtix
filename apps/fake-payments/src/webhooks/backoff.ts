/** Longest wait between two delivery attempts. */
export const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Wait before attempt `attempt` (2 = first retry): `base`, then doubling, capped at 5 minutes.
 * No jitter, so tests and testers can predict when retries arrive.
 */
export function retryDelayMs(attempt: number, baseMs: number): number {
  if (!Number.isInteger(attempt) || attempt < 2) {
    throw new RangeError(`Retries start at attempt 2, got ${attempt}`);
  }
  return Math.min(baseMs * 2 ** (attempt - 2), MAX_RETRY_DELAY_MS);
}
