import { Module } from '@nestjs/common';

import { WaitingRoomModule } from '../waiting-room/waiting-room.module.js';

import { HoldsController } from './holds.controller.js';
import { HoldsService } from './holds.service.js';
import { SeatMapService } from './seat-map.service.js';

/**
 * Seat maps (`GET /events/{eventId}/seats`) and customers' holds (C3.1), behind the waiting room
 * of ticket drops (C5.1).
 */
@Module({
  imports: [WaitingRoomModule],
  controllers: [HoldsController],
  providers: [HoldsService, SeatMapService],
})
export class HoldsModule {}
