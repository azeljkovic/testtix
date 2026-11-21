import { createHash } from 'node:crypto';

import { formatUuid } from '../infra/uuid.js';

/** Timestamp in every seed ID, so seed rows sort before rows the app creates later. */
const SEED_ID_TIME_MS = Date.UTC(2026, 0, 1);

/**
 * A deterministic UUIDv7 for a seed row, derived from a stable key such as `venue:riverside-hall`.
 *
 * It has the UUIDv7 layout (48-bit timestamp, version 7, RFC 9562 variant), like IDs the app
 * generates, but the timestamp is fixed and the remaining 74 bits come from SHA-256 of the key.
 * The same key always gives the same ID, on every run and machine, so fixture IDs can be
 * documented and used by tests.
 */
export function seedId(key: string): string {
  const hash = createHash('sha256').update(`testtix-seed:${key}`).digest();
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(SEED_ID_TIME_MS, 0, 6);
  hash.copy(bytes, 6, 0, 10);
  bytes.writeUInt8(0x70 | (bytes.readUInt8(6) & 0x0f), 6); // version 7
  bytes.writeUInt8(0x80 | (bytes.readUInt8(8) & 0x3f), 8); // variant 10xx
  return formatUuid(bytes);
}
