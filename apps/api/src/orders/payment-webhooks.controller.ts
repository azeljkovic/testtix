import { Controller, Headers, HttpCode, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PAYMENT_SIGNATURE_HEADER, PAYMENT_TIMESTAMP_HEADER } from '@testtix/shared';
import type { FastifyRequest } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { Public, SkipCsrf } from '../auth/auth.decorators.js';
import { PaymentWebhookAckDto, PaymentWebhookEventDto } from './payment-webhooks.schemas.js';
import { PaymentWebhooksService } from './payment-webhooks.service.js';

@ApiTags('webhooks')
@Public()
@SkipCsrf()
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Post('payments')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive a payment provider webhook',
    description:
      'Called by the payment provider (`apps/fake-payments`), not by clients. The signature (`X-Payments-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`, keyed with `PAYMENTS_WEBHOOK_SECRET`) and `X-Payments-Timestamp` (Unix seconds, within `PAYMENTS_WEBHOOK_TOLERANCE_SEC` of the real time, not the test clock) are checked first: 400 `webhook-signature-invalid` otherwise. A valid body is recorded once per event `id`; deliveries of an event already received answer 200 with `duplicate: true` and change nothing. The first result for an unpaid, unexpired order moves it to `PROCESSING` (its tickets are off sale), and a job confirms (`payment.succeeded`) or fails it (`payment.failed`, tickets released) after `JOB_PROCESSING_DELAY_MS`. A success for an expired order, or for an order that already has a result, is recorded as `REFUND_DUE` and never sells tickets.',
  })
  @ApiHeader({ name: PAYMENT_SIGNATURE_HEADER, required: true, description: '`v1=<hex>`' })
  @ApiHeader({ name: PAYMENT_TIMESTAMP_HEADER, required: true, description: 'Unix seconds' })
  @ApiBody({ type: PaymentWebhookEventDto })
  @ZodResponse({ status: 200, type: PaymentWebhookAckDto, description: 'Received.' })
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers(PAYMENT_SIGNATURE_HEADER.toLowerCase()) signature: string | undefined,
    @Headers(PAYMENT_TIMESTAMP_HEADER.toLowerCase()) timestamp: string | undefined,
  ) {
    // Set by Nest's JSON parser because the app is created with `rawBody: true`. Missing for a
    // request without a body, which then fails the signature or schema check like any other.
    const body = request.rawBody ?? Buffer.alloc(0);
    return this.webhooks.receive({ body, signature, timestamp });
  }
}
