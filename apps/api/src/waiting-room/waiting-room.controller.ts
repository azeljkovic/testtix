import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { CurrentUser } from '../auth/auth.decorators.js';
import { EventIdParamDto } from '../events/event.schemas.js';
import type { User } from '../generated/prisma/client.js';
import { QueueEntryDto, QueueTokenParamDto } from './waiting-room.schemas.js';
import { WaitingRoomService } from './waiting-room.service.js';

@ApiTags('waiting room')
@Controller()
export class WaitingRoomController {
  constructor(private readonly waitingRoom: WaitingRoomService) {}

  @Post('events/:eventId/queue')
  @ApiOperation({
    summary: 'Join an event’s waiting room',
    description:
      'For events with `waitingRoomEnabled` (ticket drops). One entry per customer: joining again while you wait or are admitted returns your entry with 200. Once an admission has expired, joining again puts you at the back of the queue with new tokens (201). Everyone who joins before `salesOpenAt` is let in in a random order once sales open; after that, in join order. Customers are let in at the event’s `admissionRatePerSec` per second of server time. 404 unless the event is published; 409 `no-waiting-room` for events without one; 409 `event-not-on-sale` once the event has started.',
  })
  @ZodResponse({ status: 201, type: QueueEntryDto, description: 'Your new queue entry.' })
  @ApiResponse({
    status: 200,
    type: QueueEntryDto.Output,
    description: 'Your existing queue entry.',
  })
  async join(
    @CurrentUser() user: User,
    @Param() { eventId }: EventIdParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { created, entry } = await this.waitingRoom.join(user.id, eventId);
    if (!created) void reply.status(200);
    return entry;
  }

  @Get('queue/:token')
  @ApiOperation({
    summary: 'Get your place in a waiting room',
    description:
      'Poll it while you wait: wait `retryAfterMs` between requests and stop once it is null. `PRE_SALE` (before sales open; no position yet) → `WAITING` (with `position` and `estimatedWaitMs`) → `ADMITTED` (with `admission.token`, valid until `admission.expiresAt`) → `EXPIRED`. 404 for unknown tokens, tokens replaced by joining again, and other customers’ tokens.',
  })
  @ZodResponse({ status: 200, type: QueueEntryDto, description: 'Your queue entry.' })
  status(@CurrentUser() user: User, @Param() { token }: QueueTokenParamDto) {
    return this.waitingRoom.status(user.id, token);
  }
}
