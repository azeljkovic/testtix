import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { Public } from '../auth/auth.decorators.js';
import {
  CatalogueEventDto,
  CatalogueEventPageDto,
  EventCatalogueQueryDto,
  EventSlugParamDto,
} from './catalogue.schemas.js';
import { CatalogueService } from './catalogue.service.js';

@ApiTags('catalogue')
@Public()
@Controller('events')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get()
  @ApiOperation({
    summary: 'List published events',
    description:
      'Published events starting at or after `from` (default: now, server clock), filtered, searched and sorted. Drafts and cancelled events never appear. 400 `validation-error` for an invalid filter, or a `to` that is not after `from`.',
  })
  @ZodResponse({ status: 200, type: CatalogueEventPageDto, description: 'One page of events.' })
  list(@Query() query: EventCatalogueQueryDto) {
    return this.catalogue.list(query);
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'Get a published event with its availability',
    description:
      'Any published event, past ones included, with ticket counts and prices per section. 404 for drafts, cancelled events and unknown slugs.',
  })
  @ZodResponse({ status: 200, type: CatalogueEventDto, description: 'The event.' })
  get(@Param() { slug }: EventSlugParamDto) {
    return this.catalogue.get(slug);
  }
}
