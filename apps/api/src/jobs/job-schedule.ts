import { setTimeout as sleep } from 'node:timers/promises';

import type { Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { describeError } from '../logging/describe-error.js';

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Creates, updates or removes a job scheduler (BullMQ's repeatable job) when the worker starts.
 * Every process that runs the worker does this; `apply()` must be idempotent.
 *
 * It runs in the background and retries until Redis answers, so the app still starts while Redis
 * is down (readiness reports it), the same as without a worker.
 */
export abstract class JobSchedule implements OnApplicationBootstrap, OnModuleDestroy {
  protected abstract readonly logger: Logger;
  private readonly stopping = new AbortController();

  /** Upserts (or removes) the scheduler. Throws when Redis can't be reached. */
  protected abstract apply(): Promise<void>;

  /** What `apply()` does, for the retry warning: "schedule the hold sweeper". */
  protected abstract describeApply(): string;

  onApplicationBootstrap(): void {
    void this.applyWithRetries();
  }

  onModuleDestroy(): void {
    this.stopping.abort();
  }

  // A method, not an inline check: TypeScript would assume `aborted` can't change inside the loop.
  private isStopping(): boolean {
    return this.stopping.signal.aborted;
  }

  private async applyWithRetries(): Promise<void> {
    for (let attempt = 1; !this.isStopping(); attempt++) {
      try {
        await this.apply();
        return;
      } catch (err) {
        if (this.isStopping()) return;
        const delayMs = Math.min(attempt * 1000, MAX_RETRY_DELAY_MS);
        this.logger.warn(
          `Could not ${this.describeApply()} (${describeError(err)}); retrying in ${String(delayMs)} ms`,
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
