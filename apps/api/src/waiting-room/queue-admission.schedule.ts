import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { JobSchedule } from '../jobs/job-schedule.js';
import { WAITING_ROOM_QUEUE } from './queue-admission.processor.js';

/** ID of the job scheduler that runs an admission step every `QUEUE_ADMISSION_INTERVAL_MS`. */
export const QUEUE_ADMISSION_SCHEDULER_ID = 'admit-from-waiting-rooms';

/** Creates or updates the admission job's scheduler when the worker starts. */
@Injectable()
export class QueueAdmissionSchedule extends JobSchedule {
  protected readonly logger = new Logger('QueueAdmission');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(WAITING_ROOM_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  protected describeApply(): string {
    return 'schedule the waiting-room admission job';
  }

  protected async apply(): Promise<void> {
    const intervalMs = this.config.waitingRoom.admissionIntervalMs;
    await this.queue.upsertJobScheduler(
      QUEUE_ADMISSION_SCHEDULER_ID,
      { every: intervalMs },
      {
        name: 'admit',
        opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
      },
    );
    this.logger.log(`Letting customers in from waiting rooms every ${String(intervalMs)} ms`);
  }
}
