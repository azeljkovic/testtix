import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '../generated/prisma/client.js';
import {
  CreateOrderRequestDto,
  OrderDto,
  OrderIdParamDto,
  OrderListQueryDto,
  OrderPageDto,
} from './orders.schemas.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Check out a hold',
    description:
      'Creates a `PENDING_PAYMENT` order for the tickets of your hold and a payment session: send the customer to `paymentUrl`. The order expires with the hold (`expiresAt`); releasing or replacing the hold expires it too. A hold has at most one order: checking it out again returns that order with 200. Once the payment result arrives the order is `PROCESSING` and the hold is used up (checking it out again answers 404). Free orders get no `paymentUrl`: they are `PROCESSING` at once and confirmed by the processing job. 403 `email-not-verified` until you verify your email. 404 for unknown holds and other users’ holds. 409 `hold-expired` once the hold has expired; 409 `event-not-on-sale` when the event was unpublished, cancelled or has started. 503 `payment-provider-unavailable` when the provider fails: the order is kept without a `paymentUrl` and the hold stays, so retry the same request.',
  })
  @ZodResponse({ status: 201, type: OrderDto, description: 'The new order.' })
  @ApiResponse({ status: 200, type: OrderDto.Output, description: 'The hold’s existing order.' })
  async create(
    @CurrentUser() user: User,
    @Body() { holdId }: CreateOrderRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { order, created } = await this.orders.create(user, holdId);
    if (!created) void reply.status(200);
    return order;
  }

  @Get()
  @ApiOperation({
    summary: 'List your orders',
    description: 'Newest first, every status. Statuses are at the server clock.',
  })
  @ZodResponse({ status: 200, type: OrderPageDto, description: 'One page of your orders.' })
  list(@CurrentUser() user: User, @Query() query: OrderListQueryDto) {
    return this.orders.list(user.id, query);
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Get one of your orders',
    description:
      'Poll it after payment: wait `retryAfterMs` between requests and stop once it is null (final status). `PENDING_PAYMENT` → `PROCESSING` (the provider reported the payment; tickets are off sale) → `CONFIRMED` or `FAILED` (tickets released). 404 for unknown orders and other users’ orders.',
  })
  @ZodResponse({ status: 200, type: OrderDto, description: 'The order.' })
  get(@CurrentUser() user: User, @Param() { orderId }: OrderIdParamDto) {
    return this.orders.get(user.id, orderId);
  }
}
