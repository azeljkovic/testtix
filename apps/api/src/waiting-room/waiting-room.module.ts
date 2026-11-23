import { Module } from '@nestjs/common';

import { MetricsModule } from '../metrics/metrics.module.js';
import { QueueMetrics } from './queue-metrics.js';
import { QueueStore } from './queue-store.js';
import { WaitingRoomController } from './waiting-room.controller.js';
import { WaitingRoomService } from './waiting-room.service.js';

/**
 * Ticket drops' waiting rooms (C5.1): joining and polling the queue, the admission check of the
 * seat map and holds, and the queue's `/metrics`. Letting customers in is the worker's job
 * (`QueueAdmissionModule`).
 */
@Module({
  imports: [MetricsModule],
  controllers: [WaitingRoomController],
  providers: [QueueStore, WaitingRoomService, QueueMetrics],
  exports: [QueueStore, WaitingRoomService],
})
export class WaitingRoomModule {}
