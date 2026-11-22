import { describe, expect, it } from 'vitest';

import {
  DATE_RANGE_MESSAGE,
  dateRangeError,
  DEFAULT_LIST_PARAMS,
  hasFilters,
  parseListParams,
  toApiQuery,
  toSearchParams,
} from './list-params.js';

const parse = (query: string) => parseListParams(new URLSearchParams(query));

describe('parseListParams', () => {
  it('defaults to the first page by date, ascending, without filters', () => {
    expect(parse('')).toEqual(DEFAULT_LIST_PARAMS);
  });

  it('reads every parameter', () => {
    expect(
      parse(
        'q=+echo+&category=CONCERT&venue=riverside-hall&seating=MIXED&availability=ON_SALE&from=2026-12-01&to=2026-12-31&sort=price&order=desc&page=3',
      ),
    ).toEqual({
      q: 'echo',
      category: 'CONCERT',
      venue: 'riverside-hall',
      seating: 'MIXED',
      availability: 'ON_SALE',
      from: '2026-12-01',
      to: '2026-12-31',
      sort: 'price',
      order: 'desc',
      page: 3,
    });
  });

  it.each([
    ['category=PARTY', 'category', undefined],
    ['seating=seated', 'seating', undefined],
    ['availability=SOON', 'availability', undefined],
    ['sort=popularity', 'sort', 'date'],
    ['order=up', 'order', 'asc'],
    ['page=0', 'page', 1],
    ['page=-2', 'page', 1],
    ['page=1.5', 'page', 1],
    ['page=abc', 'page', 1],
    ['from=2026-02-30', 'from', undefined],
    ['to=12/01/2026', 'to', undefined],
    ['venue=', 'venue', undefined],
  ] as const)('ignores %s', (query, key, expected) => {
    expect(parse(query)[key]).toBe(expected);
  });

  it('cuts the search to the API maximum of 100 characters', () => {
    expect(parse(`q=${'a'.repeat(120)}`).q).toHaveLength(100);
  });
});

describe('toSearchParams', () => {
  it('leaves defaults out, so the plain list is just /events', () => {
    expect(toSearchParams(DEFAULT_LIST_PARAMS).toString()).toBe('');
  });

  it('round-trips through parseListParams', () => {
    const query =
      'q=echo&category=TALK&venue=loft-23&seating=GA&availability=SOLD_OUT&from=2026-12-01&to=2026-12-02&sort=name&order=desc&page=2';
    expect(toSearchParams(parse(query)).toString()).toBe(query);
  });
});

describe('toApiQuery', () => {
  it('always sends the sort, order, page and page size', () => {
    expect(toApiQuery(DEFAULT_LIST_PARAMS)).toEqual({
      sort: 'date',
      order: 'asc',
      page: 1,
      pageSize: 20,
    });
  });

  it('turns the days into the start of "from" and the end of "to", in local time', () => {
    const query = toApiQuery(parse('from=2026-12-01&to=2026-12-31'));
    expect(query.from).toBe(new Date(2026, 11, 1).toISOString());
    // `to` is exclusive in the API: midnight after the last day.
    expect(query.to).toBe(new Date(2027, 0, 1).toISOString());
  });

  it('passes the filters through', () => {
    expect(
      toApiQuery(parse('q=echo&category=MEETUP&venue=loft-23&seating=GA&availability=ON_SALE')),
    ).toMatchObject({
      q: 'echo',
      category: 'MEETUP',
      venue: 'loft-23',
      seating: 'GA',
      availability: 'ON_SALE',
    });
  });
});

describe('dateRangeError', () => {
  it('rejects a "to" day before the "from" day', () => {
    expect(dateRangeError(parse('from=2026-12-02&to=2026-12-01'))).toBe(DATE_RANGE_MESSAGE);
  });

  it.each(['from=2026-12-01&to=2026-12-01', 'from=2026-12-01', 'to=2026-12-01', ''])(
    'accepts %s',
    (query) => {
      expect(dateRangeError(parse(query))).toBeUndefined();
    },
  );
});

describe('hasFilters', () => {
  it('counts search and filters, but not sort or page', () => {
    expect(hasFilters(parse('sort=name&order=desc&page=2'))).toBe(false);
    expect(hasFilters(parse('q=echo'))).toBe(true);
    expect(hasFilters(parse('to=2026-12-01'))).toBe(true);
  });
});
