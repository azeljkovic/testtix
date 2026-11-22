import { Module } from '@nestjs/common';

import { AdminBatchesService } from './admin-batches.service.js';
import { AdminEventsController } from './admin-events.controller.js';
import { AdminEventsService } from './admin-events.service.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';

/**
 * Events and ticket batches. The admin API lives under `/admin/events`, the public catalogue
 * under `/events`.
 */
@Module({
  controllers: [AdminEventsController, CatalogueController],
  providers: [AdminBatchesService, AdminEventsService, CatalogueService],
})
export class EventsModule {}
