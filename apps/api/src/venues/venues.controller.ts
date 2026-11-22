import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { Public } from '../auth/auth.decorators.js';
import { CatalogueVenuePageDto, VenueListQueryDto } from './venue.schemas.js';
import { VenuesService } from './venues.service.js';

@ApiTags('catalogue')
@Public()
@Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @ApiOperation({
    summary: 'List venues with published events',
    description:
      'The choices for the `venue` filter of `GET /events` (by slug). Sorted by name, then ID.',
  })
  @ZodResponse({ status: 200, type: CatalogueVenuePageDto, description: 'One page of venues.' })
  list(@Query() query: VenueListQueryDto) {
    return this.venues.list(query);
  }
}
