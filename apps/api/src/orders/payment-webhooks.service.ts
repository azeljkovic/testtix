import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type OrderStatus,
  type PaymentEventOutcome,
  type PaymentWebhookEvent,
  PaymentWebhookEventSchema,
} from '@testtix/shared';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ProblemException } from '../errors/problem.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { deleteHold, lockHoldUnits, lockUserEvent } from '../holds/hold-locks.js';
import { isUniqueViolation } from '../infra/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { uuidv7 } from '../infra/uuid.js';
import { checkWebhookSignature, type SignedWebhook } from '../payments/webhook-signature.js';
import { OrderJobs } from './order-jobs.js';
import { startProcessing } from './order-transitions.js';
import { effectiveStatus } from './order-views.js';
import type { PaymentWebhookAck } from './payment-webhooks.schemas.js';

type Db = Prisma.TransactionClient;

const SIGNATURE_FAILURES = {
  missing: 'The X-Payments-Signature and X-Payments-Timestamp headers are required.',
  malformed: 'The signature headers are malformed.',
  stale: 'The signature timestamp is outside the replay window.',
  mismatch: 'The signature does not match the request body.',
} as const;

interface Applied {
  outcome: PaymentEventOutcome;
  orderId: string | null;
  /** The event moved its order to `PROCESSING`: the job must finish it. */
  processing: boolean;
}

/**
 * Receives the payment provider's webhooks (C4.3).
 *
 * 1. The signature and its timestamp are checked first, on the raw body (400
 *    `webhook-signature-invalid`), then the body's shape (400 `validation-error`).
 * 2. Each provider event is recorded once (`payment_events.provider_event_id` is unique): a
 *    duplicate delivery, even a concurrent one, is answered 200 and changes nothing.
 * 3. The first result for an unpaid, unexpired order decides it (`APPLIED`): the order moves to
 *    `PROCESSING` and its tickets leave the hold (`startProcessing()`), and a job confirms or fails
 *    it after `JOB_PROCESSING_DELAY_MS`.
 * 4. A success that no order can use is recorded as `REFUND_DUE` and never sells anything: the
 *    order had expired (late payment), already had its result, or the session or amount isn't
 *    the order's. Failures that change nothing are `IGNORED`.
 *
 * Order expiry is judged by the server clock, like everywhere else; only the replay window uses
 * the real time.
 */
@Injectable()
export class PaymentWebhooksService {
  private readonly logger = new Logger(PaymentWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly jobs: OrderJobs,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async receive(webhook: SignedWebhook): Promise<PaymentWebhookAck> {
    const { webhookSecret, webhookToleranceMs } = this.config.payments;
    const check = checkWebhookSignature(
      webhook,
      webhookSecret,
      this.clock.realNow(),
      webhookToleranceMs,
    );
    if (!check.ok) {
      throw new ProblemException(
        'WEBHOOK_SIGNATURE_INVALID',
        400,
        'Webhook signature invalid',
        SIGNATURE_FAILURES[check.reason],
      );
    }
    const event = parseEvent(webhook.body);
    const now = await this.clock.now();

    let applied: Applied;
    try {
      applied = await this.prisma.$transaction((tx) => applyEvent(tx, event, now));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return this.duplicate(event.id);
    }
    if (applied.processing && applied.orderId !== null) {
      await this.jobs.enqueueFinalize(applied.orderId);
    }
    if (applied.outcome === 'REFUND_DUE') {
      this.logger.warn(
        `Payment event ${event.id} (session ${event.data.sessionId}) can't be used by an order; flagged for refund`,
      );
    }
    return { eventId: event.id, outcome: applied.outcome, duplicate: false };
  }

  /**
   * A delivery of an event already recorded. Its order's job is enqueued again in case the first
   * delivery committed but never enqueued it (the job ID makes this a no-op otherwise).
   */
  private async duplicate(providerEventId: string): Promise<PaymentWebhookAck> {
    const recorded = await this.prisma.paymentEvent.findUniqueOrThrow({
      where: { providerEventId },
      select: { outcome: true, order: { select: { id: true, status: true } } },
    });
    if (recorded.outcome === 'APPLIED' && recorded.order?.status === 'PROCESSING') {
      await this.jobs.enqueueFinalize(recorded.order.id);
    }
    return { eventId: providerEventId, outcome: recorded.outcome, duplicate: true };
  }
}

function parseEvent(body: Buffer): PaymentWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    // Unreachable through Fastify, which parses JSON bodies before the handler runs.
    json = undefined;
  }
  const result = PaymentWebhookEventSchema.safeParse(json);
  if (!result.success) throw new ZodValidationException(result.error);
  return result.data;
}

const uuid = z.uuid();

/**
 * Decides what the event does and records it, in one transaction. Throws a unique violation when
 * the event was recorded already (the caller treats it as a duplicate).
 */
async function applyEvent(tx: Db, event: PaymentWebhookEvent, now: Date): Promise<Applied> {
  const succeeded = event.type === 'payment.succeeded';
  const record = async (orderId: string | null, outcome: PaymentEventOutcome) => {
    await tx.paymentEvent.create({
      data: {
        id: uuidv7(now),
        providerEventId: event.id,
        orderId,
        type: event.type,
        outcome,
        payload: event,
        receivedAt: now,
      },
    });
  };

  const orderId = uuid.safeParse(event.data.metadata.orderId).data;
  const found =
    orderId === undefined
      ? null
      : await tx.order.findUnique({
          where: { id: orderId },
          select: { userId: true, eventId: true, holdId: true },
        });
  if (orderId === undefined || found === null) {
    const outcome = succeeded ? 'REFUND_DUE' : 'IGNORED';
    await record(null, outcome);
    return { outcome, orderId: null, processing: false };
  }

  // The holds locking order (event, the user's advisory lock, the hold's units), then the order.
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${found.eventId}::uuid FOR SHARE`;
  if (found.holdId !== null) {
    await lockUserEvent(tx, found.userId, found.eventId);
    await lockHoldUnits(tx, found.holdId);
  }
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      expiresAt: true,
      holdId: true,
      totalCents: true,
      paymentSessionId: true,
      paymentEvents: { where: { outcome: 'APPLIED' }, select: { payload: true } },
    },
  });

  const status: OrderStatus = effectiveStatus(order, now);
  if (status === 'EXPIRED' && order.status === 'PENDING_PAYMENT') {
    // Expired by the clock but not swept yet: store it, and free the tickets, before deciding.
    if (order.holdId === null) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'EXPIRED', updatedAt: now },
      });
    } else {
      await deleteHold(tx, order.holdId, now);
    }
  }

  const ownPayment =
    event.data.sessionId === order.paymentSessionId && event.data.amountCents === order.totalCents;
  if (status === 'PENDING_PAYMENT' && ownPayment && order.holdId !== null) {
    await startProcessing(tx, orderId, order.holdId, now);
    await record(orderId, 'APPLIED');
    return { outcome: 'APPLIED', orderId, processing: true };
  }

  // The same payment reported again under another event ID changes nothing and is not refunded.
  const sameAsApplied = order.paymentEvents.some((applied) => {
    const payload = PaymentWebhookEventSchema.safeParse(applied.payload).data;
    return payload?.type === event.type && payload.data.sessionId === event.data.sessionId;
  });
  const outcome = succeeded && !sameAsApplied ? 'REFUND_DUE' : 'IGNORED';
  await record(orderId, outcome);
  return { outcome, orderId, processing: false };
}
