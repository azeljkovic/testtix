import { Module } from '@nestjs/common';

import { AdminVenuesController } from './admin-venues.controller.js';
import { AdminVenuesService } from './admin-venues.service.js';

/** Venues and their layouts. The admin API lives under `/admin/venues`. */
@Module({
  controllers: [AdminVenuesController],
  providers: [AdminVenuesService],
})
export class VenuesModule {}
