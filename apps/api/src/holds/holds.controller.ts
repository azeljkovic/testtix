import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ADMISSION_TOKEN_HEADER, PROBLEM_CONTENT_TYPE } from '@testtix/shared';
import { ZodResponse } from 'nestjs-zod';

import { CurrentUser, Public } from '../auth/auth.decorators.js';
import { EventIdParamDto } from '../events/event.schemas.js';
import type { User } from '../generated/prisma/client.js';
import { WaitingRoomService } from '../waiting-room/waiting-room.service.js';
import {
  CurrentHoldQueryDto,
  HoldDto,
  HoldIdParamDto,
  HoldRequestDto,
  SeatMapDto,
} from './holds.schemas.js';
import { HoldsService } from './holds.service.js';
import { SeatMapService } from './seat-map.service.js';

/** Fastify lower-cases incoming header names. */
const ADMISSION_HEADER_KEY = ADMISSION_TOKEN_HEADER.toLowerCase();

function AdmissionTokenHeader(): MethodDecorator {
  return ApiHeader({
    name: ADMISSION_TOKEN_HEADER,
    required: false,
    description:
      'Admission token from the waiting room (`GET /queue/{token}`), for events with `waitingRoomEnabled`. Ignored for other events.',
  });
}

@ApiTags('holds')
@Controller()
export class HoldsController {
  constructor(
    private readonly seatMaps: SeatMapService,
    private readonly holds: HoldsService,
    private readonly waitingRoom: WaitingRoomService,
  ) {}

  @Get('events/:eventId/seats')
  @Public()
  @ApiOperation({
    summary: 'Get an event’s seat map',
    description:
      'Every section of the venue in order: seated sections with each seat’s status and price, GA sections with the places a hold could take. Statuses are at the server clock; a seat whose hold expired is `AVAILABLE`. 404 unless the event is published. For an event with a waiting room, 403 `queue-required` without an unexpired admission token for the event (`X-Admission-Token`).',
  })
  @AdmissionTokenHeader()
  @ZodResponse({ status: 200, type: SeatMapDto, description: 'The seat map.' })
  async seatMap(
    @Param() { eventId }: EventIdParamDto,
    @Headers(ADMISSION_HEADER_KEY) admissionToken: string | undefined,
  ) {
    await this.waitingRoom.requireAdmission(eventId, admissionToken);
    return this.seatMaps.get(eventId);
  }

  @Post('events/:eventId/holds')
  @ApiOperation({
    summary: 'Hold seats and GA places',
    description:
      'All or nothing: either every requested ticket is held until `expiresAt` (now + the event’s hold duration), or nothing is. Replaces your previous hold for this event (a failed request keeps it). 400 `validation-error` for more tickets than the event’s `maxTicketsPerOrder`, or seats and sections that aren’t at the event’s venue. 404 unless the event is published. 409 `event-not-on-sale` before sales open or once the event has started; 409 `tickets-unavailable` when a seat is sold, held or not on sale, or a GA section has fewer places left than requested. For an event with a waiting room, 403 `queue-required` without your unexpired admission token for the event (`X-Admission-Token`).',
  })
  @AdmissionTokenHeader()
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
  async create(
    @CurrentUser() user: User,
    @Param() { eventId }: EventIdParamDto,
    @Body() body: HoldRequestDto,
    @Headers(ADMISSION_HEADER_KEY) admissionToken: string | undefined,
  ) {
    await this.waitingRoom.requireAdmission(eventId, admissionToken, user.id);
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
