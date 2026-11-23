import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';
import { TicketEmailService } from '../tickets/ticket-email.service.js';
import { OrderJobsModule } from './order-jobs.module.js';
import { ORDER_PROCESSING_QUEUE } from './order-jobs.js';
import { OrderProcessingProcessor } from './order-processing.processor.js';
import { OrderProcessingService } from './order-processing.service.js';
import { OrderRecoverySchedule } from './order-recovery.schedule.js';

/**
 * The order processing jobs (C4.3: finalize; C4.4: the e-ticket email) and their recovery
 * schedule. Part of the worker (`WorkerModule`).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: ORDER_PROCESSING_QUEUE }),
    OrderJobsModule,
    MailModule,
  ],
  providers: [
    OrderProcessingService,
    OrderProcessingProcessor,
    OrderRecoverySchedule,
    TicketEmailService,
  ],
  exports: [OrderProcessingService, TicketEmailService],
})
export class OrderProcessingModule {}
