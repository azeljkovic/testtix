import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseConfig } from '../config/config.schema.js';
import { ClockService } from './clock.service.js';

const REAL = new Date('2026-11-21T12:00:00.000Z');

/** A Redis client that fails the test if the service touches it. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- a stand-in that throws on any use; a real client would try to connect.
const untouchableRedis = new Proxy(
  {},
  {
    get: (_target, property) => {
      throw new Error(`Redis was accessed: ${String(property)}`);
    },
  },
) as Redis;

describe('ClockService with test mode off', () => {
  const clock = new ClockService(parseConfig({}), untouchableRedis);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(REAL);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the real time without asking Redis', async () => {
    expect(await clock.now()).toEqual(REAL);
    expect(await clock.read()).toEqual({ mode: 'real', nowMs: REAL.getTime(), offsetMs: 0 });
  });

  it('refuses to change the clock', async () => {
    await expect(clock.freezeAt(REAL)).rejects.toThrow(/only be changed in test mode/);
    await expect(clock.advanceBy(1000)).rejects.toThrow(/only be changed in test mode/);
    await expect(clock.reset()).rejects.toThrow(/only be changed in test mode/);
  });
});
