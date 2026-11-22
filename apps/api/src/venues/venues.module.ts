import { Module } from '@nestjs/common';

import { AdminVenuesController } from './admin-venues.controller.js';
import { AdminVenuesService } from './admin-venues.service.js';
import { VenuesController } from './venues.controller.js';
import { VenuesService } from './venues.service.js';

/**
 * Venues and their layouts. The admin API lives under `/admin/venues`; `GET /venues` lists the
 * venues of the public catalogue.
 */
@Module({
  controllers: [AdminVenuesController, VenuesController],
  providers: [AdminVenuesService, VenuesService],
})
export class VenuesModule {}
