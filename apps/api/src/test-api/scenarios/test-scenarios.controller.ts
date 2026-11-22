import { Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';

import {
  BasicCatalogueResultDto,
  OneSeatLeftResultDto,
  SoldOutEventResultDto,
} from './scenario.schemas.js';
import { basicCatalogue, oneSeatLeft, soldOutEvent } from './scenarios.js';
import { TestApiController } from '../test-api.decorator.js';
import { TestScenariosService } from './test-scenarios.service.js';

const ADDITIVE =
  'Test mode only. Adds a new venue, events (and orders) with fresh IDs on every call; the slugs and titles end in a random suffix, so calls never collide and existing data is not touched. Open even when the server has a test API key, since it only adds data.';

/**
 * One route per scenario, so each documents its own response. An unknown scenario is a plain
 * 404 like any unknown path.
 */
@TestApiController('seed')
export class TestScenariosController {
  constructor(private readonly scenarios: TestScenariosService) {}

  @Post('basic-catalogue')
  @ApiOperation({
    summary: 'Seed scenario: a small catalogue',
    description: `Three published events on sale: a concert (seats and a GA area), a seated talk and a GA meetup, at one new venue. ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: BasicCatalogueResultDto, description: 'What was created.' })
  async basicCatalogue() {
    return this.scenarios.create(basicCatalogue);
  }

  @Post('sold-out-event')
  @ApiOperation({
    summary: 'Seed scenario: a sold-out event',
    description: `A published event on sale whose 12 tickets (8 seats, 4 GA places) are all sold, through confirmed orders of a new buyer. ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: SoldOutEventResultDto, description: 'What was created.' })
  async soldOutEvent() {
    return this.scenarios.create(soldOutEvent);
  }

  @Post('one-seat-left')
  @ApiOperation({
    summary: 'Seed scenario: one seat left',
    description: `A published seated event on sale with 8 seats, all sold except row B seat 4. ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: OneSeatLeftResultDto, description: 'What was created.' })
  async oneSeatLeft() {
    return this.scenarios.create(oneSeatLeft);
  }
}
