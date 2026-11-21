import { describe, expect, it } from 'vitest';

import { parseStoredClock, readClock } from './clock-state.js';

const REAL = Date.parse('2026-11-21T12:00:00.000Z');

describe('readClock', () => {
  it('returns the real time when nothing is stored', () => {
    expect(readClock({}, REAL)).toEqual({ mode: 'real', nowMs: REAL, offsetMs: 0 });
  });

  it('returns the frozen time, with its distance from the real time', () => {
    const frozenAt = Date.parse('2026-01-01T00:00:00.000Z');
    expect(readClock({ frozenAt }, REAL)).toEqual({
      mode: 'frozen',
      nowMs: frozenAt,
      offsetMs: frozenAt - REAL,
    });
  });

  it('ignores the offset while frozen', () => {
    expect(readClock({ frozenAt: 5, offsetMs: 1000 }, REAL)).toEqual({
      mode: 'frozen',
      nowMs: 5,
      offsetMs: 5 - REAL,
    });
  });

  it('shifts the real time by the offset', () => {
    expect(readClock({ offsetMs: 60_000 }, REAL)).toEqual({
      mode: 'offset',
      nowMs: REAL + 60_000,
      offsetMs: 60_000,
    });
  });

  it('treats a zero offset as real time', () => {
    expect(readClock({ offsetMs: 0 }, REAL).mode).toBe('real');
  });
});

describe('parseStoredClock', () => {
  it('maps missing fields to an empty state', () => {
    expect(parseStoredClock(null, null)).toEqual({});
  });

  it('parses integer fields, including negative ones', () => {
    expect(parseStoredClock('-1000', '600000')).toEqual({ frozenAt: -1000, offsetMs: 600000 });
  });

  it.each([['abc'], ['1.5'], [''], ['1e3'], ['99999999999999999999']])(
    'rejects %j as corrupt',
    (value) => {
      expect(() => parseStoredClock(value, null)).toThrow(
        /Corrupt clock state in Redis: frozenAt=/,
      );
    },
  );
});
