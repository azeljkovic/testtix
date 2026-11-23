import { Injectable } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RateLimitStore } from '../rate-limit/rate-limit.store.js';
import { resetAndSeedDatabase, type SeedSummary } from '../seed/seed.js';
import { QueueStore } from '../waiting-room/queue-store.js';
import { type ClockState, toClockState } from './clock.schemas.js';

export interface ResetResult {
  seedDay: string;
  clock: ClockState;
  rows: SeedSummary;
}

/** Puts the server back into its baseline state (`POST /__test/reset`). */
@Injectable()
export class TestResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly queues: QueueStore,
    private readonly rateLimits: RateLimitStore,
  ) {}

  /**
   * Resets the clock (to the real time, or frozen at `freezeAt`), then replaces all data with the
   * baseline seed for the clock's day. The data swap is one transaction (`resetAndSeedDatabase`).
   * Waiting rooms (C5.1) are emptied after it, since their entries point at events that no
   * longer exist, and the rate-limit counters (C5.3) are cleared, so every client starts afresh.
   */
  async reset(freezeAt?: Date): Promise<ResetResult> {
    if (freezeAt === undefined) {
      await this.clock.reset();
    } else {
      await this.clock.freezeAt(freezeAt);
    }
    const reading = await this.clock.read();
    const now = new Date(reading.nowMs);
    const rows = await resetAndSeedDatabase(this.prisma, now);
    await this.queues.clear();
    await this.rateLimits.clear();
    return { seedDay: now.toISOString().slice(0, 10), clock: toClockState(reading), rows };
  }
}
