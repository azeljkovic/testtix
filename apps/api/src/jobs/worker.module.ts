import { Module } from '@nestjs/common';

import { HoldSweeperModule } from '../holds/hold-sweeper.module.js';
import { OrderProcessingModule } from '../orders/order-processing.module.js';
import { QueueAdmissionModule } from '../waiting-room/queue-admission.module.js';
import { JobsModule } from './jobs.module.js';

/**
 * The background worker: every BullMQ processor and job schedule (C3.2, C4.3, C5.1). It runs inside the API
 * process by default (`WORKER_IN_PROCESS=true`), or on its own through `src/worker.ts`, so it can
 * be scaled separately from the HTTP API.
 */
@Module({
  imports: [JobsModule, HoldSweeperModule, OrderProcessingModule, QueueAdmissionModule],
})
export class WorkerModule {}
