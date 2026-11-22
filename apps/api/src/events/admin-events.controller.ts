import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { Roles } from '../auth/auth.decorators.js';
import { AdminBatchesService } from './admin-batches.service.js';
import { AdminEventsService } from './admin-events.service.js';
import {
  AdminBatchDto,
  AdminEventDto,
  AdminEventListQueryDto,
  AdminEventPageDto,
  CreateEventRequestDto,
  EventIdParamDto,
  ReleaseBatchRequestDto,
  UpdateEventRequestDto,
} from './event.schemas.js';

const UPDATED = { status: 200, type: AdminEventDto, description: 'The event after the change.' };

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/events')
export class AdminEventsController {
  constructor(
    private readonly events: AdminEventsService,
    private readonly batches: AdminBatchesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List events',
    description: 'Every status, drafts included. Sorted by start time, then ID.',
  })
  @ZodResponse({ status: 200, type: AdminEventPageDto, description: 'One page of events.' })
  list(@Query() query: AdminEventListQueryDto) {
    return this.events.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an event',
    description:
      'Creates a DRAFT event, not yet in the catalogue. Release a batch, then publish it. `startsAt` must be in the future (server clock), `endsAt` after it and `salesOpenAt` before it. 409 `slug-taken` when a given `slug` is taken.',
  })
  @ZodResponse({ status: 201, type: AdminEventDto, description: 'The new event.' })
  create(@Body() body: CreateEventRequestDto) {
    return this.events.create(body);
  }

  @Get(':eventId')
  @ApiOperation({ summary: 'Get an event with its batches and ticket counts' })
  @ZodResponse({ status: 200, type: AdminEventDto, description: 'The event.' })
  get(@Param() { eventId }: EventIdParamDto) {
    return this.events.get(eventId);
  }

  @Patch(':eventId')
  @ApiOperation({
    summary: 'Update an event',
    description:
      'Changes only the fields sent; the time rules apply to the result, and a new `startsAt` must be in the future. 409 `layout-locked` when changing `venueId` after a batch was released, `event-status-conflict` for a cancelled event, `slug-taken` when the new `slug` is taken.',
  })
  @ZodResponse(UPDATED)
  update(@Param() { eventId }: EventIdParamDto, @Body() body: UpdateEventRequestDto) {
    return this.events.update(eventId, body);
  }

  @Delete(':eventId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a draft event',
    description:
      'Deletes the event with its batches and tickets. 409 `event-status-conflict` unless it is a DRAFT; 409 `event-has-sales` when it has orders, or tickets sold or held.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  async delete(@Param() { eventId }: EventIdParamDto): Promise<void> {
    await this.events.delete(eventId);
  }

  @Post(':eventId/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish an event',
    description:
      'DRAFT → PUBLISHED: the event appears in the catalogue. 409 `event-has-no-batches` without a released batch, `event-already-started` once `startsAt` has passed, `event-status-conflict` unless it is a DRAFT.',
  })
  @ZodResponse(UPDATED)
  publish(@Param() { eventId }: EventIdParamDto) {
    return this.events.publish(eventId);
  }

  @Post(':eventId/unpublish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unpublish an event',
    description:
      'PUBLISHED → DRAFT: the event leaves the catalogue. 409 `event-has-sales` while tickets are sold or held (cancel it instead), `event-status-conflict` unless it is PUBLISHED.',
  })
  @ZodResponse(UPDATED)
  unpublish(@Param() { eventId }: EventIdParamDto) {
    return this.events.unpublish(eventId);
  }

  @Post(':eventId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel an event',
    description:
      'DRAFT or PUBLISHED → CANCELLED. Final: a cancelled event cannot be changed, published or get new batches. 409 `event-status-conflict` when it is already cancelled.',
  })
  @ZodResponse(UPDATED)
  cancel(@Param() { eventId }: EventIdParamDto) {
    return this.events.cancel(eventId);
  }

  @Post(':eventId/batches')
  @ApiOperation({
    summary: 'Release a ticket batch',
    description:
      'Puts seats and GA places on sale at one price, now or at `releasesAt`. Seated inventory is released by section (`seatedSectionIds`: the seats no earlier batch released) or by seat (`seatIds`); GA inventory by quantity per section (`gaSections`). Unreleased inventory is not sellable. 400 `validation-error` for sections or seats not at the event’s venue; 409 `inventory-already-released`, `ga-capacity-exceeded`, or `event-status-conflict` for a cancelled event.',
  })
  @ZodResponse({ status: 201, type: AdminBatchDto, description: 'The new batch.' })
  releaseBatch(@Param() { eventId }: EventIdParamDto, @Body() body: ReleaseBatchRequestDto) {
    return this.batches.release(eventId, body);
  }
}
