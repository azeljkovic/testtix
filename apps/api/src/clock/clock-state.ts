/** How the server clock currently relates to real time. */
export const CLOCK_MODES = ['real', 'frozen', 'offset'] as const;
export type ClockMode = (typeof CLOCK_MODES)[number];

/**
 * The clock overrides kept in Redis. Both fields are epoch-based milliseconds.
 * `frozenAt` wins over `offsetMs`: a frozen clock doesn't move until it is advanced or reset.
 */
export interface StoredClock {
  frozenAt?: number;
  offsetMs?: number;
}

export interface ClockReading {
  mode: ClockMode;
  /** Server "now" in epoch milliseconds. */
  nowMs: number;
  /** Server "now" minus the real time. Negative when frozen in the past. */
  offsetMs: number;
}

/** Applies the stored overrides to the real time. Pure, so the arithmetic is unit-testable. */
export function readClock(stored: StoredClock, realNowMs: number): ClockReading {
  if (stored.frozenAt !== undefined) {
    return { mode: 'frozen', nowMs: stored.frozenAt, offsetMs: stored.frozenAt - realNowMs };
  }
  if (stored.offsetMs !== undefined && stored.offsetMs !== 0) {
    return { mode: 'offset', nowMs: realNowMs + stored.offsetMs, offsetMs: stored.offsetMs };
  }
  return { mode: 'real', nowMs: realNowMs, offsetMs: 0 };
}

/**
 * Parses the Redis hash fields (`HMGET frozenAt offsetMs`). Missing fields are `null`.
 * Anything that isn't a safe integer means the state was written by something else: fail loudly
 * rather than serve a wrong time.
 */
export function parseStoredClock(frozenAt: string | null, offsetMs: string | null): StoredClock {
  const stored: StoredClock = {};
  if (frozenAt !== null) stored.frozenAt = parseMillis('frozenAt', frozenAt);
  if (offsetMs !== null) stored.offsetMs = parseMillis('offsetMs', offsetMs);
  return stored;
}

function parseMillis(field: string, value: string): number {
  const parsed = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`Corrupt clock state in Redis: ${field}=${JSON.stringify(value)}`);
  }
  return parsed;
}
