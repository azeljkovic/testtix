import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets in constant time. Hashing first gives both sides the same length, so
 * neither the content nor the length of `expected` leaks through timing.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
