import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { OrderJobsModule } from './order-jobs.module.js';
import { ORDER_PROCESSING_QUEUE } from './order-jobs.js';
import { OrderProcessingProcessor } from './order-processing.processor.js';
import { OrderProcessingService } from './order-processing.service.js';
import { OrderRecoverySchedule } from './order-recovery.schedule.js';

/** The order processing job and its recovery schedule (C4.3). Part of the worker (`WorkerModule`). */
@Module({
  imports: [BullModule.registerQueue({ name: ORDER_PROCESSING_QUEUE }), OrderJobsModule],
  providers: [OrderProcessingService, OrderProcessingProcessor, OrderRecoverySchedule],
  exports: [OrderProcessingService],
})
export class OrderProcessingModule {}
