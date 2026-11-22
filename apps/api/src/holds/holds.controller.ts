import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE } from '@testtix/shared';
import { ZodResponse } from 'nestjs-zod';

import { CurrentUser, Public } from '../auth/auth.decorators.js';
import { EventIdParamDto } from '../events/event.schemas.js';
import type { User } from '../generated/prisma/client.js';
import {
  CurrentHoldQueryDto,
  HoldDto,
  HoldIdParamDto,
  HoldRequestDto,
  SeatMapDto,
} from './holds.schemas.js';
import { HoldsService } from './holds.service.js';
import { SeatMapService } from './seat-map.service.js';

@ApiTags('holds')
@Controller()
export class HoldsController {
  constructor(
    private readonly seatMaps: SeatMapService,
    private readonly holds: HoldsService,
  ) {}

  @Get('events/:eventId/seats')
  @Public()
  @ApiOperation({
    summary: 'Get an event’s seat map',
    description:
      'Every section of the venue in order: seated sections with each seat’s status and price, GA sections with the places a hold could take. Statuses are at the server clock; a seat whose hold expired is `AVAILABLE`. 404 unless the event is published.',
  })
  @ZodResponse({ status: 200, type: SeatMapDto, description: 'The seat map.' })
  seatMap(@Param() { eventId }: EventIdParamDto) {
    return this.seatMaps.get(eventId);
  }

  @Post('events/:eventId/holds')
  @ApiOperation({
    summary: 'Hold seats and GA places',
    description:
      'All or nothing: either every requested ticket is held until `expiresAt` (now + the event’s hold duration), or nothing is. Replaces your previous hold for this event (a failed request keeps it). 400 `validation-error` for more tickets than the event’s `maxTicketsPerOrder`, or seats and sections that aren’t at the event’s venue. 404 unless the event is published. 409 `event-not-on-sale` before sales open or once the event has started; 409 `tickets-unavailable` when a seat is sold, held or not on sale, or a GA section has fewer places left than requested.',
  })
  @ZodResponse({ status: 201, type: HoldDto, description: 'The new hold.' })
  @ApiResponse({
    status: 409,
    description:
      '`tickets-unavailable` (body below, with what could not be held) or `event-not-on-sale` (plain problem details, without the two lists).',
    content: {
      [PROBLEM_CONTENT_TYPE]: {
        schema: { $ref: '#/components/schemas/TicketsUnavailableProblem' },
      },
    },
  })
  create(
    @CurrentUser() user: User,
    @Param() { eventId }: EventIdParamDto,
    @Body() body: HoldRequestDto,
  ) {
    return this.holds.create(user.id, eventId, body);
  }

  @Get('holds/current')
  @ApiOperation({
    summary: 'Get your active hold',
    description:
      'Your unexpired hold for `eventId`, or without it your most recent unexpired hold. 404 when there is none.',
  })
  @ZodResponse({ status: 200, type: HoldDto, description: 'The hold.' })
  current(@CurrentUser() user: User, @Query() { eventId }: CurrentHoldQueryDto) {
    return this.holds.current(user.id, eventId);
  }

  @Delete('holds/:holdId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Release a hold',
    description:
      'Its tickets become available at once. Works on expired holds too. 404 for unknown holds and other users’ holds.',
  })
  @ApiNoContentResponse({ description: 'Released.' })
  async release(@CurrentUser() user: User, @Param() { holdId }: HoldIdParamDto): Promise<void> {
    await this.holds.release(user.id, holdId);
  }
}
