import { describe, expect, it } from 'vitest';

import { SLUG_MAX_LENGTH, SlugSchema, slugify } from './slugs.js';

describe('slugify', () => {
  it.each([
    ['Midnight Echoes — Live!', 'midnight-echoes-live'],
    ['  Café Société  ', 'cafe-societe'],
    ['Testing in Production (Safely)', 'testing-in-production-safely'],
    ['AC/DC 2027', 'ac-dc-2027'],
    ['---', 'fallback'],
    ['🎸🎶', 'fallback'],
  ])('turns %j into %j', (title, slug) => {
    expect(slugify(title, 'fallback')).toBe(slug);
  });

  it('leaves room for a numeric suffix and never ends in a hyphen', () => {
    const slug = slugify(`${'a'.repeat(89)} b`, 'x');
    expect(slug).toBe('a'.repeat(89));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH - 10);
  });

  it('produces valid slugs', () => {
    for (const title of ['Hello, World', 'Ünïcödé Fest', 'x'.repeat(300)]) {
      expect(SlugSchema.safeParse(slugify(title, 'event')).success).toBe(true);
    }
  });
});

describe('SlugSchema', () => {
  it.each(['a', 'riverside-hall', 'gig-2'])('accepts %j', (slug) => {
    expect(SlugSchema.parse(slug)).toBe(slug);
  });

  it('trims surrounding spaces', () => {
    expect(SlugSchema.parse(' gig ')).toBe('gig');
  });

  it.each(['', 'Upper', 'two--hyphens', '-leading', 'trailing-', 'under_score', 'a'.repeat(101)])(
    'rejects %j',
    (slug) => {
      expect(SlugSchema.safeParse(slug).success).toBe(false);
    },
  );
});
