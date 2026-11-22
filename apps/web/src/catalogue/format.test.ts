import { describe, expect, it } from 'vitest';

import {
  formatEventDateTime,
  formatEventTimeRange,
  formatPriceRange,
  ticketCount,
} from './format.js';

// ICU puts a narrow no-break space (U+202F) before AM/PM; `\s` matches it.
describe('formatEventDateTime', () => {
  it('shows the time in the venue’s time zone, whatever the browser’s', () => {
    expect(formatEventDateTime('2026-12-13T04:30:00.000Z', 'America/New_York')).toMatch(
      /^Sat, Dec 12, 2026, 11:30\sPM EST$/,
    );
    expect(formatEventDateTime('2026-12-13T04:30:00.000Z', 'Europe/Berlin')).toMatch(
      /^Sun, Dec 13, 2026, 5:30\sAM GMT\+1$/,
    );
  });
});

describe('formatEventTimeRange', () => {
  it('shares the date when the event ends the same day', () => {
    expect(
      formatEventTimeRange(
        '2026-12-12T23:00:00.000Z',
        '2026-12-13T01:30:00.000Z',
        'America/New_York',
      ),
    ).toMatch(/^Sat, Dec 12, 2026, 6:00\s–\s8:30\sPM EST$/);
  });
});

describe('formatPriceRange', () => {
  it.each([
    [{ minCents: 2500, maxCents: 2500 }, '$25.00'],
    [{ minCents: 2500, maxCents: 8900 }, '$25.00 – $89.00'],
    [{ minCents: 0, maxCents: 0 }, 'Free'],
    [{ minCents: 0, maxCents: 1000 }, 'Free – $10.00'],
  ])('%o → %s', (range, expected) => {
    expect(formatPriceRange(range)).toBe(expected);
  });
});

describe('ticketCount', () => {
  it.each([
    [1, '1 ticket'],
    [6, '6 tickets'],
    [1250, '1,250 tickets'],
  ])('%i → %s', (count, expected) => {
    expect(ticketCount(count)).toBe(expected);
  });
});
