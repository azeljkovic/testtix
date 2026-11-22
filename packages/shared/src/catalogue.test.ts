import { describe, expect, it } from 'vitest';

import { CATALOGUE_SEARCH_MAX_LENGTH, EventCatalogueQuerySchema } from './catalogue.js';

describe('EventCatalogueQuerySchema', () => {
  it('defaults to the first page by date, ascending', () => {
    expect(EventCatalogueQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'date',
      order: 'asc',
    });
  });

  it('parses every filter from query strings', () => {
    expect(
      EventCatalogueQuerySchema.parse({
        page: '2',
        pageSize: '5',
        q: '  Echoes ',
        category: 'CONCERT',
        venue: 'riverside-hall',
        from: '2027-01-01T00:00:00Z',
        to: '2027-02-01T00:00:00+01:00',
        seating: 'MIXED',
        availability: 'ON_SALE',
        sort: 'price',
        order: 'desc',
      }),
    ).toEqual({
      page: 2,
      pageSize: 5,
      q: 'Echoes',
      category: 'CONCERT',
      venue: 'riverside-hall',
      from: '2027-01-01T00:00:00Z',
      to: '2027-02-01T00:00:00+01:00',
      seating: 'MIXED',
      availability: 'ON_SALE',
      sort: 'price',
      order: 'desc',
    });
  });

  it.each([
    ['category', { category: 'concert' }],
    ['seating', { seating: 'seated' }],
    ['availability', { availability: 'AVAILABLE' }],
    ['sort', { sort: 'popularity' }],
    ['order', { order: 'up' }],
    ['from', { from: '2027-01-01' }],
    ['to', { to: 'tomorrow' }],
    ['q', { q: 'x'.repeat(CATALOGUE_SEARCH_MAX_LENGTH + 1) }],
  ])('rejects an invalid %s', (path, query) => {
    const result = EventCatalogueQuerySchema.safeParse(query);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path]);
  });

  it('rejects a range whose end is not after its start', () => {
    const at = '2027-01-01T00:00:00Z';
    const result = EventCatalogueQuerySchema.safeParse({ from: at, to: at });
    expect(result.error?.issues).toMatchObject([
      { path: ['to'], message: '"To" must be after "from"' },
    ]);
    expect(
      EventCatalogueQuerySchema.safeParse({ from: at, to: '2027-01-01T00:00:00.001Z' }).success,
    ).toBe(true);
  });
});
