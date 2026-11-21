import { describe, expect, it } from 'vitest';

import { formatUuid, uuidv7 } from './uuid.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampOf = (uuid: string) => Number.parseInt(uuid.replaceAll('-', '').slice(0, 12), 16);

describe('uuidv7', () => {
  it('returns a UUIDv7 carrying the given time', () => {
    const at = new Date('2026-11-21T10:15:00.123Z');
    const id = uuidv7(at);
    expect(id).toMatch(UUID_V7);
    expect(timestampOf(id)).toBe(at.getTime());
  });

  it('is unique even for the same millisecond (a frozen clock)', () => {
    const at = new Date('2026-11-21T10:15:00.000Z');
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(at)));
    expect(ids.size).toBe(1000);
  });

  it('sorts by time', () => {
    const earlier = uuidv7(new Date('2026-11-21T10:15:00.000Z'));
    const later = uuidv7(new Date('2026-11-21T10:15:00.001Z'));
    expect(earlier < later).toBe(true);
  });

  it('clamps a time before 1970 to the epoch instead of failing', () => {
    expect(timestampOf(uuidv7(new Date('1960-01-01T00:00:00Z')))).toBe(0);
  });
});

describe('formatUuid', () => {
  it('formats 16 bytes as 8-4-4-4-12 hex digits', () => {
    expect(formatUuid(Buffer.from('00112233445566778899aabbccddeeff', 'hex'))).toBe(
      '00112233-4455-6677-8899-aabbccddeeff',
    );
  });
});
