import { Injectable } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { resetAndSeedDatabase, type SeedSummary } from '../seed/seed.js';
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
  ) {}

  /**
   * Resets the clock (to the real time, or frozen at `freezeAt`), then replaces all data with the
   * baseline seed for the clock's day. The data swap is one transaction (`resetAndSeedDatabase`).
   * Later chunks also clear their Redis state here (queues, waiting rooms, rate limits).
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
    return { seedDay: now.toISOString().slice(0, 10), clock: toClockState(reading), rows };
  }
}
