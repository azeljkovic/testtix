import { randomBytes } from 'node:crypto';

/** Formats 16 bytes as a lower-case UUID string (`8-4-4-4-12` hex digits). */
export function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * A random UUIDv7 (RFC 9562) whose timestamp is `at`, for rows whose IDs are needed before they
 * are inserted (e.g. to link seats and inventory units in one `createMany` batch). Pass the time
 * from `ClockService`, so IDs sort like the rows' `createdAt`. Prisma's `@default(uuid(7))`
 * produces the same layout, but from the real time.
 */
export function uuidv7(at: Date): string {
  const bytes = randomBytes(16);
  // 48-bit Unix milliseconds. A clock frozen before 1970 would not fit, so clamp to the epoch.
  bytes.writeUIntBE(Math.max(0, at.getTime()), 0, 6);
  bytes.writeUInt8(0x70 | (bytes.readUInt8(6) & 0x0f), 6); // version 7
  bytes.writeUInt8(0x80 | (bytes.readUInt8(8) & 0x3f), 8); // variant 10xx
  return formatUuid(bytes);
}
