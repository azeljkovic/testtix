import { describe, expect, it } from 'vitest';

import { seedId } from './seed-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seedId', () => {
  it('returns a UUIDv7', () => {
    expect(seedId('venue:riverside-hall')).toMatch(UUID_V7);
  });

  it('is the same for the same key, on every run', () => {
    // Pinned: fixture IDs are documented in docs/testing-guide.md and must never change.
    expect(seedId('venue:riverside-hall')).toBe('019b76da-a800-7fbc-a24e-2ac58eab7ced');
  });

  it('differs between keys', () => {
    const ids = new Set(Array.from({ length: 1000 }, (_, i) => seedId(`key:${i}`)));
    expect(ids.size).toBe(1000);
  });

  it('carries a fixed timestamp of 2026-01-01T00:00:00Z', () => {
    const ms = Number.parseInt(seedId('anything').replaceAll('-', '').slice(0, 12), 16);
    expect(new Date(ms).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
