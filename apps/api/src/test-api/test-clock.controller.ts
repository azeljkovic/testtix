import { Body, Get, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import { ClockService } from '../clock/clock.service.js';
import { ClockCommandDto, ClockStateDto, toClockState } from './clock.schemas.js';
import { TestApiController } from './test-api.decorator.js';
import { RequiresTestKey } from './test-key.guard.js';

@TestApiController('clock')
export class TestClockController {
  constructor(private readonly clock: ClockService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the server clock',
    description: 'Test mode only. Returns the time the server uses for holds, sessions and drops.',
  })
  @ZodResponse({ status: 200, type: ClockStateDto, description: 'The current server clock.' })
  async get() {
    return toClockState(await this.clock.read());
  }

  @Post()
  @RequiresTestKey()
  @ApiOperation({
    summary: 'Freeze, advance or reset the server clock',
    description:
      'Test mode only. Affects every client of this server, so it needs `X-Test-Key` when the server has a test API key.',
  })
  @ZodResponse({
    status: 200,
    type: ClockStateDto,
    description: 'The server clock after the change.',
  })
  async set(@Body() command: ClockCommandDto) {
    if (command.freezeAt !== undefined) {
      await this.clock.freezeAt(new Date(command.freezeAt));
    } else if (command.advanceBy !== undefined) {
      await this.clock.advanceBy(command.advanceBy);
    } else {
      await this.clock.reset();
    }
    return toClockState(await this.clock.read());
  }
}
