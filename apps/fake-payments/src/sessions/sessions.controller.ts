import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';

import { ApiKeyGuard } from '../infra/api-key.guard.js';
import { PaymentSessionsService } from './payment-sessions.service.js';
import { CreatePaymentSessionDto, PaymentSessionDto } from './sessions.dto.js';

/** Server-to-server API: the shop creates a session and reads its state. */
@Controller('sessions')
@UseGuards(ApiKeyGuard)
export class SessionsController {
  constructor(private readonly sessions: PaymentSessionsService) {}

  @Post()
  @ZodResponse({ status: 201, type: PaymentSessionDto })
  create(@Body() body: CreatePaymentSessionDto) {
    return this.sessions.toView(this.sessions.create(body));
  }

  @Get(':id')
  @ZodResponse({ status: 200, type: PaymentSessionDto })
  findOne(@Param('id') id: string) {
    const session = this.sessions.find(id);
    if (session === undefined) throw new NotFoundException('Payment session not found.');
    return this.sessions.toView(session);
  }
}
