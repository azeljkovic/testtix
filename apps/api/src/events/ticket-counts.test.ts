import { describe, expect, it } from 'vitest';

import { sumCounts, type UnitCountRow } from './ticket-counts.js';

const row = (
  batchId: string,
  sectionId: string,
  total: number,
  sold: number,
  held: number,
): UnitCountRow => ({
  eventId: 'e',
  batchId,
  sectionId,
  total,
  sold,
  held,
});

describe('sumCounts', () => {
  const rows = [row('b1', 's1', 10, 3, 2), row('b1', 's2', 5, 0, 0), row('b2', 's1', 4, 4, 0)];

  it('adds up every row and derives available', () => {
    expect(sumCounts(rows)).toEqual({ total: 19, sold: 7, held: 2, available: 10 });
  });

  it('adds up the filtered rows', () => {
    expect(sumCounts(rows, (r) => r.batchId === 'b1')).toEqual({
      total: 15,
      sold: 3,
      held: 2,
      available: 10,
    });
  });

  it('is all zeros without rows', () => {
    expect(sumCounts([])).toEqual({ total: 0, sold: 0, held: 0, available: 0 });
  });
});
