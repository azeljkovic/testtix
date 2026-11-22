import { Module } from '@nestjs/common';

import { HoldsController } from './holds.controller.js';
import { HoldsService } from './holds.service.js';
import { SeatMapService } from './seat-map.service.js';

/** Seat maps (`GET /events/{eventId}/seats`) and customers' holds (C3.1). */
@Module({
  controllers: [HoldsController],
  providers: [HoldsService, SeatMapService],
})
export class HoldsModule {}
