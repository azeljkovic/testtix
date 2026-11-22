import { setTimeout as sleep } from 'node:timers/promises';

import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { describeError } from '../logging/describe-error.js';
import { HOLD_SWEEPER_QUEUE } from './hold-sweeper.processor.js';

/** ID of the job scheduler (BullMQ's repeatable job) that enqueues a sweep every interval. */
export const HOLD_SWEEPER_SCHEDULER_ID = 'sweep-expired-holds';

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Creates or updates the hold sweeper's job scheduler on startup, or removes it when
 * `HOLD_SWEEPER_ENABLED=false`, so turning the sweeper off also stops a schedule an earlier
 * deployment left in Redis. Every process that runs the worker does this; it is idempotent.
 *
 * It runs in the background and retries until Redis answers, so the app still starts while Redis
 * is down (readiness reports it), the same as without a worker.
 */
@Injectable()
export class HoldSweeperSchedule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('HoldSweeper');
  private readonly stopping = new AbortController();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(HOLD_SWEEPER_QUEUE) private readonly queue: Queue,
  ) {}

  onApplicationBootstrap(): void {
    void this.apply();
  }

  onModuleDestroy(): void {
    this.stopping.abort();
  }

  // A method, not an inline check: TypeScript would assume `aborted` can't change inside the loop.
  private isStopping(): boolean {
    return this.stopping.signal.aborted;
  }

  private async apply(): Promise<void> {
    const { enabled, intervalMs } = this.config.holdSweeper;
    for (let attempt = 1; !this.isStopping(); attempt++) {
      try {
        if (enabled) {
          await this.queue.upsertJobScheduler(
            HOLD_SWEEPER_SCHEDULER_ID,
            { every: intervalMs },
            {
              name: 'sweep',
              // Keep a few finished jobs for inspection, not one per interval forever.
              opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
            },
          );
          this.logger.log(`Sweeping expired holds every ${String(intervalMs)} ms`);
        } else if (await this.queue.removeJobScheduler(HOLD_SWEEPER_SCHEDULER_ID)) {
          this.logger.log('Hold sweeper disabled: removed its schedule');
        }
        return;
      } catch (err) {
        if (this.isStopping()) return;
        const delayMs = Math.min(attempt * 1000, MAX_RETRY_DELAY_MS);
        this.logger.warn(
          `Could not ${enabled ? 'schedule' : 'unschedule'} the hold sweeper (${describeError(err)}); retrying in ${String(delayMs)} ms`,
        );
        try {
          await sleep(delayMs, undefined, { signal: this.stopping.signal, ref: false });
        } catch {
          return; // Shutting down.
        }
      }
    }
  }
}
