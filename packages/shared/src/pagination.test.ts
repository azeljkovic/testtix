import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PageQuerySchema,
  pageWindow,
  toPage,
} from './pagination.js';

describe('PageQuerySchema', () => {
  it('defaults to the first page', () => {
    expect(PageQuerySchema.parse({})).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT });
  });

  it('coerces query strings', () => {
    expect(PageQuerySchema.parse({ page: '3', pageSize: '5' })).toEqual({ page: 3, pageSize: 5 });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { pageSize: '0' },
    { pageSize: String(PAGE_SIZE_MAX + 1) },
  ])('rejects %j', (query) => {
    expect(PageQuerySchema.safeParse(query).success).toBe(false);
  });

  it.each([
    [{ page: 'abc' }, 'Page must be a whole number of at least 1'],
    [{ page: '0' }, 'Page must be a whole number of at least 1'],
    [{ pageSize: 'abc' }, `Page size must be a whole number from 1 to ${PAGE_SIZE_MAX}`],
    [{ pageSize: '2.5' }, `Page size must be a whole number from 1 to ${PAGE_SIZE_MAX}`],
    [{ pageSize: '1000' }, `Page size must be a whole number from 1 to ${PAGE_SIZE_MAX}`],
  ])('explains what is wrong with %j in one message', (query, message) => {
    const result = PageQuerySchema.safeParse(query);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([message]);
  });
});

describe('pageWindow', () => {
  it('skips the earlier pages', () => {
    expect(pageWindow({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
    expect(pageWindow({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('toPage', () => {
  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [5, 1, 5],
  ])('counts %i items in pages of %i as %i pages', (total, pageSize, totalPages) => {
    expect(toPage([], total, { page: 1, pageSize })).toEqual({
      items: [],
      page: 1,
      pageSize,
      total,
      totalPages,
    });
  });
});
