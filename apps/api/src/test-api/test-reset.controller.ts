import { Body, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';

import {
  OptionalResetRequestSchema,
  type ResetRequest,
  ResetRequestDto,
  ResetResponseDto,
} from './reset.schemas.js';
import { TestApiController } from './test-api.decorator.js';
import { RequiresTestKey } from './test-key.guard.js';
import { TestResetService } from './test-reset.service.js';

@TestApiController('reset')
export class TestResetController {
  constructor(private readonly resets: TestResetService) {}

  @Post()
  @HttpCode(200)
  @RequiresTestKey()
  @ApiOperation({
    summary: 'Reset all data to the baseline seed and reset the clock',
    description:
      'Test mode only. Deletes every row (users, sessions, holds, orders and scenario data included) and empties every waiting room, resets the clock (or freezes it at `freezeAt`) and inserts the baseline seed for the clock date. The swap is atomic: other requests see the old data or the new baseline, never a half-empty database. Affects every client of this server, so it needs `X-Test-Key` when the server has a test API key.',
  })
  @ApiBody({ type: ResetRequestDto, required: false })
  @ZodResponse({
    status: 200,
    type: ResetResponseDto,
    description: 'The baseline is in place.',
  })
  async reset(
    // Not typed as the DTO: the global pipe would reject a missing body before this one runs.
    @Body(new ZodValidationPipe(OptionalResetRequestSchema)) body: ResetRequest | undefined,
  ) {
    const freezeAt = body?.freezeAt;
    return this.resets.reset(freezeAt === undefined ? undefined : new Date(freezeAt));
  }
}
