import { describe, expect, it } from 'vitest';

import { fromZonedLocal, toZonedLocal } from './zoned-time.js';

const NEW_YORK = 'America/New_York';

describe('toZonedLocal', () => {
  it('shows an instant as the wall-clock time of the zone', () => {
    expect(toZonedLocal('2026-12-06T01:00:00.000Z', NEW_YORK)).toBe('2026-12-05T20:00');
    expect(toZonedLocal('2026-07-01T00:00:00.000Z', NEW_YORK)).toBe('2026-06-30T20:00');
    expect(toZonedLocal('2026-12-06T01:00:00.000Z', 'Asia/Kolkata')).toBe('2026-12-06T06:30');
    expect(toZonedLocal('2026-12-06T00:00:00.000Z', 'UTC')).toBe('2026-12-06T00:00');
  });
});

describe('fromZonedLocal', () => {
  it('turns a wall-clock time into an instant, in winter and summer', () => {
    expect(fromZonedLocal('2026-12-05T20:00', NEW_YORK)).toEqual({
      ok: true,
      iso: '2026-12-06T01:00:00.000Z',
    });
    expect(fromZonedLocal('2026-06-30T20:00', NEW_YORK)).toEqual({
      ok: true,
      iso: '2026-07-01T00:00:00.000Z',
    });
    expect(fromZonedLocal('2026-12-06T06:30', 'Asia/Kolkata')).toEqual({
      ok: true,
      iso: '2026-12-06T01:00:00.000Z',
    });
  });

  it('takes the first of two matches when the clocks go back', () => {
    // New York leaves daylight saving time at 2 AM on Nov 1, 2026: 1:30 AM happens twice.
    expect(fromZonedLocal('2026-11-01T01:30', NEW_YORK)).toEqual({
      ok: true,
      iso: '2026-11-01T05:30:00.000Z',
    });
    expect(fromZonedLocal('2026-11-01T02:30', NEW_YORK)).toEqual({
      ok: true,
      iso: '2026-11-01T07:30:00.000Z',
    });
  });

  it('refuses a time the clocks skip', () => {
    // Clocks go from 2 AM to 3 AM on Mar 8, 2026.
    expect(fromZonedLocal('2026-03-08T02:30', NEW_YORK)).toEqual({ ok: false, reason: 'skipped' });
    expect(fromZonedLocal('2026-03-08T03:00', NEW_YORK)).toEqual({
      ok: true,
      iso: '2026-03-08T07:00:00.000Z',
    });
  });

  it.each(['', '2026-12-05', '2026-12-05 20:00', '2026-02-30T20:00', '2026-12-05T24:00'])(
    'refuses %j',
    (value) => {
      expect(fromZonedLocal(value, NEW_YORK)).toEqual({ ok: false, reason: 'invalid' });
    },
  );

  it('round-trips with toZonedLocal', () => {
    for (const iso of ['2026-01-15T12:34:00.000Z', '2026-08-31T23:59:00.000Z']) {
      const local = toZonedLocal(iso, 'Europe/Paris');
      expect(fromZonedLocal(local, 'Europe/Paris')).toEqual({ ok: true, iso });
    }
  });
});
