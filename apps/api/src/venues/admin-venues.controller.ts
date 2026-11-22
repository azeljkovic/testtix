import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { Roles } from '../auth/auth.decorators.js';
import { AdminVenuesService } from './admin-venues.service.js';
import {
  AdminVenueDto,
  AdminVenuePageDto,
  CreateVenueRequestDto,
  UpdateVenueRequestDto,
  VenueIdParamDto,
  VenueListQueryDto,
} from './venue.schemas.js';

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/venues')
export class AdminVenuesController {
  constructor(private readonly venues: AdminVenuesService) {}

  @Get()
  @ApiOperation({ summary: 'List venues', description: 'Sorted by name, then ID.' })
  @ZodResponse({ status: 200, type: AdminVenuePageDto, description: 'One page of venues.' })
  list(@Query() query: VenueListQueryDto) {
    return this.venues.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a venue and its layout',
    description:
      'Seated sections are generated as a grid (`rows` × `seatsPerRow`); GA sections get a capacity. The response lists every seat with its ID, for releasing individual seats. 409 `slug-taken` when a given `slug` is taken.',
  })
  @ZodResponse({ status: 201, type: AdminVenueDto, description: 'The new venue.' })
  create(@Body() body: CreateVenueRequestDto) {
    return this.venues.create(body);
  }

  @Get(':venueId')
  @ApiOperation({ summary: 'Get a venue with every seat' })
  @ZodResponse({ status: 200, type: AdminVenueDto, description: 'The venue.' })
  get(@Param() { venueId }: VenueIdParamDto) {
    return this.venues.get(venueId);
  }

  @Patch(':venueId')
  @ApiOperation({
    summary: 'Update a venue',
    description:
      'Changes only the fields sent. `sections` replaces the whole layout with new section and seat IDs: 409 `layout-locked` once tickets have been released for any event at the venue. 409 `slug-taken` when the new `slug` is taken.',
  })
  @ZodResponse({ status: 200, type: AdminVenueDto, description: 'The updated venue.' })
  update(@Param() { venueId }: VenueIdParamDto, @Body() body: UpdateVenueRequestDto) {
    return this.venues.update(venueId, body);
  }

  @Delete(':venueId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a venue',
    description: '409 `venue-in-use` while any event (of any status) uses the venue.',
  })
  @ApiNoContentResponse({ description: 'Deleted, with its sections and seats.' })
  async delete(@Param() { venueId }: VenueIdParamDto): Promise<void> {
    await this.venues.delete(venueId);
  }
}
