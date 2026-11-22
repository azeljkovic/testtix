import { Module } from '@nestjs/common';

import { AdminBatchesService } from './admin-batches.service.js';
import { AdminEventsController } from './admin-events.controller.js';
import { AdminEventsService } from './admin-events.service.js';

/** Events and ticket batches. The admin API lives under `/admin/events`. */
@Module({
  controllers: [AdminEventsController],
  providers: [AdminBatchesService, AdminEventsService],
})
export class EventsModule {}
