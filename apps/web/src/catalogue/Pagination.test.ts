import { describe, expect, it } from 'vitest';

import { pageItems } from './Pagination.js';

describe('pageItems', () => {
  it.each([
    [1, 1, [1]],
    [1, 3, [1, 2, 3]],
    [1, 10, [1, 2, 'gap', 10]],
    [5, 10, [1, 'gap', 4, 5, 6, 'gap', 10]],
    [10, 10, [1, 'gap', 9, 10]],
    // A gap would hide one page only: show the page.
    [4, 10, [1, 2, 3, 4, 5, 'gap', 10]],
    [7, 10, [1, 'gap', 6, 7, 8, 9, 10]],
  ])('page %i of %i → %o', (page, totalPages, expected) => {
    expect(pageItems(page, totalPages)).toEqual(expected);
  });
});
