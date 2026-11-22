import { describe, expect, it } from 'vitest';

import {
  canonicalTimeZone,
  CreateVenueRequestSchema,
  sectionInputCapacity,
  SectionsInputSchema,
  UpdateVenueRequestSchema,
  VENUE_LIMITS,
} from './venues.js';

const venue = {
  name: 'Test Hall',
  address: '1 Main St',
  city: 'Port Ellis',
  timezone: 'America/New_York',
  sections: [
    { type: 'SEATED', name: 'Stalls', rows: 2, seatsPerRow: 3 },
    { type: 'GA', name: 'Floor', capacity: 10 },
  ],
};

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('CreateVenueRequestSchema', () => {
  it('accepts a mixed layout and leaves the slug out', () => {
    const parsed = CreateVenueRequestSchema.parse(venue);
    expect(parsed.slug).toBeUndefined();
    expect(parsed.sections).toHaveLength(2);
  });

  it('stores the canonical time zone spelling', () => {
    expect(CreateVenueRequestSchema.parse({ ...venue, timezone: 'europe/paris' }).timezone).toBe(
      'Europe/Paris',
    );
  });

  it.each(['Mars/Olympus', '', 'GMT+25'])('rejects the time zone %j', (timezone) => {
    expect(issues(CreateVenueRequestSchema.safeParse({ ...venue, timezone }))).toContainEqual({
      path: 'timezone',
      message: expect.any(String) as string,
    });
  });

  it('rejects unknown fields and section types', () => {
    expect(CreateVenueRequestSchema.safeParse({ ...venue, id: 'x' }).success).toBe(false);
    expect(
      CreateVenueRequestSchema.safeParse({
        ...venue,
        sections: [{ type: 'BOX', name: 'Box', capacity: 4 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a seated section with a capacity, and a GA section with rows', () => {
    expect(
      SectionsInputSchema.safeParse([{ type: 'SEATED', name: 'A', capacity: 5 }]).success,
    ).toBe(false);
    expect(
      SectionsInputSchema.safeParse([{ type: 'GA', name: 'A', rows: 2, seatsPerRow: 2 }]).success,
    ).toBe(false);
  });
});

describe('SectionsInputSchema', () => {
  it('needs at least one section', () => {
    expect(issues(SectionsInputSchema.safeParse([]))).toEqual([
      { path: '', message: 'Add at least one section' },
    ]);
  });

  it('rejects section names that differ only in case', () => {
    expect(
      issues(
        SectionsInputSchema.safeParse([
          { type: 'GA', name: 'Floor', capacity: 1 },
          { type: 'GA', name: 'floor', capacity: 1 },
        ]),
      ),
    ).toEqual([{ path: '1.name', message: 'Section names must be unique within the venue' }]);
  });

  it('enforces the size limits', () => {
    expect(
      SectionsInputSchema.safeParse([
        { type: 'SEATED', name: 'A', rows: VENUE_LIMITS.rowsPerSection + 1, seatsPerRow: 1 },
      ]).success,
    ).toBe(false);
    expect(
      SectionsInputSchema.safeParse([
        { type: 'GA', name: 'A', capacity: VENUE_LIMITS.gaCapacity + 1 },
      ]).success,
    ).toBe(false);
    const tooMany = Array.from({ length: VENUE_LIMITS.sections + 1 }, (_, i) => ({
      type: 'GA',
      name: `S${i}`,
      capacity: 1,
    }));
    expect(SectionsInputSchema.safeParse(tooMany).success).toBe(false);
  });

  it('caps the total capacity of the venue', () => {
    const big = Array.from({ length: 5 }, (_, i) => ({
      type: 'GA' as const,
      name: `S${i}`,
      capacity: VENUE_LIMITS.gaCapacity,
    }));
    expect(big.reduce((sum, s) => sum + sectionInputCapacity(s), 0)).toBeGreaterThan(
      VENUE_LIMITS.totalCapacity,
    );
    expect(issues(SectionsInputSchema.safeParse(big))[0]?.message).toMatch(/at most 20000/);
  });
});

describe('UpdateVenueRequestSchema', () => {
  it('accepts any subset of fields', () => {
    expect(UpdateVenueRequestSchema.parse({})).toEqual({});
    expect(UpdateVenueRequestSchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
  });
});

describe('canonicalTimeZone', () => {
  it('returns undefined for unknown zones', () => {
    expect(canonicalTimeZone('Nowhere/Land')).toBeUndefined();
    expect(canonicalTimeZone('UTC')).toBe('UTC');
  });
});
