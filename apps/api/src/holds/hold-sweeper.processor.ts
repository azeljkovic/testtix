import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { describeError } from '../logging/describe-error.js';
import { HoldSweeperService, type SweepResult } from './hold-sweeper.service.js';

export const HOLD_SWEEPER_QUEUE = 'hold-sweeper';

/** Runs a sweep for every job on the hold-sweeper queue (each one comes from the job scheduler). */
@Processor(HOLD_SWEEPER_QUEUE)
export class HoldSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger('HoldSweeper');

  constructor(private readonly sweeper: HoldSweeperService) {
    super();
  }

  async process(): Promise<SweepResult> {
    const result = await this.sweeper.sweep();
    if (result.holds > 0) {
      const holds = result.holds === 1 ? 'hold' : 'holds';
      const tickets = result.units === 1 ? 'ticket' : 'tickets';
      this.logger.log(
        `Released ${String(result.holds)} expired ${holds} (${String(result.units)} ${tickets})`,
      );
    }
    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`Hold sweep ${job?.id ?? '(unknown job)'} failed: ${describeError(err)}`);
  }
}
