import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { describeError } from '../logging/describe-error.js';
import { type AdmissionResult, QueueAdmissionService } from './queue-admission.service.js';

export const WAITING_ROOM_QUEUE = 'waiting-room';

/** Runs an admission step for every job on the waiting-room queue (from the job scheduler). */
@Processor(WAITING_ROOM_QUEUE)
export class QueueAdmissionProcessor extends WorkerHost {
  private readonly logger = new Logger('QueueAdmission');

  constructor(private readonly admission: QueueAdmissionService) {
    super();
  }

  async process(): Promise<AdmissionResult[]> {
    const results = await this.admission.admit();
    for (const { eventId, admitted } of results) {
      if (admitted > 0) {
        this.logger.debug(`Let ${String(admitted)} in from the waiting room of event ${eventId}`);
      }
    }
    return results;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`Admission step ${job?.id ?? '(unknown job)'} failed: ${describeError(err)}`);
  }
}
