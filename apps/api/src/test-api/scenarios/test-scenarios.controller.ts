import { Body, Post } from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';

import {
  BasicCatalogueResultDto,
  ConfirmedOrderResultDto,
  GaLastTicketResultDto,
  GaMeetupResultDto,
  type HoldAboutToExpireRequest,
  HoldAboutToExpireRequestDto,
  HoldAboutToExpireResultDto,
  OneSeatLeftResultDto,
  OptionalHoldAboutToExpireRequestSchema,
  SoldOutEventResultDto,
} from './scenario.schemas.js';
import { basicCatalogue, gaLastTicket, gaMeetup, oneSeatLeft, soldOutEvent } from './scenarios.js';
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
    description: `A published seated event on sale with 8 seats, all sold except row B seat 4 (\`seat\`; the others are \`soldSeats\`). ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: OneSeatLeftResultDto, description: 'What was created.' })
  async oneSeatLeft() {
    return this.scenarios.create(oneSeatLeft);
  }

  @Post('hold-about-to-expire')
  @ApiOperation({
    summary: 'Seed scenario: a hold about to expire',
    description: `A published seated event on sale (8 seats) where a new customer holds row A seats 1 and 2 until \`expiresInSec\` from now (default 60). The response logs the holder in, like \`POST /__test/sessions\`. ${ADDITIVE}`,
  })
  @ApiBody({ type: HoldAboutToExpireRequestDto, required: false })
  @ZodResponse({ status: 201, type: HoldAboutToExpireResultDto, description: 'What was created.' })
  async holdAboutToExpire(
    @Body(new ZodValidationPipe(OptionalHoldAboutToExpireRequestSchema))
    body: HoldAboutToExpireRequest | undefined,
  ) {
    return this.scenarios.holdAboutToExpire(body ?? { expiresInSec: 60 });
  }

  @Post('ga-meetup')
  @ApiOperation({
    summary: 'Seed scenario: a general-admission meetup',
    description: `A published GA-only meetup on sale with two sections: Floor (20 places at $10.00, then 20 at $15.00) and Balcony (10 at $20.00). ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: GaMeetupResultDto, description: 'What was created.' })
  async gaMeetup() {
    return this.scenarios.create(gaMeetup);
  }

  @Post('ga-last-ticket')
  @ApiOperation({
    summary: 'Seed scenario: one GA place left',
    description: `A published GA meetup on sale whose Floor (10 places, $8.00) has one place left; the other nine are sold through confirmed orders of a new buyer. ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: GaLastTicketResultDto, description: 'What was created.' })
  async gaLastTicket() {
    return this.scenarios.create(gaLastTicket);
  }

  @Post('confirmed-order')
  @ApiOperation({
    summary: 'Seed scenario: a confirmed order with tickets',
    description: `A published concert on sale (Seats rows A–B × 4 at $45.00, Standing GA of 10 at $25.00) and a new customer’s \`CONFIRMED\` order for row A seats 1 and 2 and one Standing place, with three tickets (IDs and codes in the response). No e-ticket email is sent; download a ticket with \`GET /tickets/{ticketId}/pdf\`. The response logs the customer in, like \`POST /__test/sessions\`. ${ADDITIVE}`,
  })
  @ZodResponse({ status: 201, type: ConfirmedOrderResultDto, description: 'What was created.' })
  async confirmedOrder() {
    return this.scenarios.confirmedOrder();
  }
}
