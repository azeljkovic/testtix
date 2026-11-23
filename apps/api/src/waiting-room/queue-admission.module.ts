import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QueueAdmissionProcessor, WAITING_ROOM_QUEUE } from './queue-admission.processor.js';
import { QueueAdmissionSchedule } from './queue-admission.schedule.js';
import { QueueAdmissionService } from './queue-admission.service.js';
import { QueueStore } from './queue-store.js';

/** The repeatable job that lets customers in from waiting rooms (C5.1). Part of `WorkerModule`. */
@Module({
  imports: [BullModule.registerQueue({ name: WAITING_ROOM_QUEUE })],
  providers: [QueueStore, QueueAdmissionService, QueueAdmissionProcessor, QueueAdmissionSchedule],
  exports: [QueueAdmissionService],
})
export class QueueAdmissionModule {}
