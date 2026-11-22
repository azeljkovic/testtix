import { describe, expect, it } from 'vitest';

import { nextPosition } from './grid-navigation.js';

// Three rows: 5, 5 and 3 seats.
const rows = [5, 5, 3];

describe('nextPosition', () => {
  it.each([
    ['ArrowRight', { row: 1, col: 2 }, { row: 1, col: 3 }],
    ['ArrowLeft', { row: 1, col: 2 }, { row: 1, col: 1 }],
    ['ArrowUp', { row: 1, col: 2 }, { row: 0, col: 2 }],
    ['ArrowDown', { row: 1, col: 2 }, { row: 2, col: 2 }],
    ['Home', { row: 1, col: 2 }, { row: 1, col: 0 }],
    ['End', { row: 1, col: 2 }, { row: 1, col: 4 }],
  ])('%s moves from %o to %o', (key, from, to) => {
    expect(nextPosition(rows, from, key)).toEqual(to);
  });

  it.each([
    ['ArrowLeft', { row: 0, col: 0 }],
    ['ArrowRight', { row: 0, col: 4 }],
    ['ArrowUp', { row: 0, col: 3 }],
    ['ArrowDown', { row: 2, col: 1 }],
  ])('%s stops at the edge of the grid (%o)', (key, from) => {
    expect(nextPosition(rows, from, key)).toEqual(from);
  });

  it('lands on the last seat of a shorter row', () => {
    expect(nextPosition(rows, { row: 1, col: 4 }, 'ArrowDown')).toEqual({ row: 2, col: 2 });
  });

  it('goes to the first and last seat of the grid with Ctrl+Home / Ctrl+End', () => {
    expect(nextPosition(rows, { row: 1, col: 2 }, 'Home', true)).toEqual({ row: 0, col: 0 });
    expect(nextPosition(rows, { row: 1, col: 2 }, 'End', true)).toEqual({ row: 2, col: 2 });
  });

  it('ignores other keys', () => {
    expect(nextPosition(rows, { row: 0, col: 0 }, 'a')).toBeUndefined();
    expect(nextPosition(rows, { row: 0, col: 0 }, 'Tab')).toBeUndefined();
  });
});
