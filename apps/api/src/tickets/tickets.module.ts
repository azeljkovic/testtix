import { Module } from '@nestjs/common';

import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Ticket downloads (C4.4). Tickets are issued by the order processing job. */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
