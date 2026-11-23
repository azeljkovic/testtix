import { z } from 'zod';

import { CURRENCY } from './constants.js';

/**
 * Contract of the fake payment provider (`apps/fake-payments`, C4.1), shared by the provider and
 * the API that calls it (C4.2) and receives its webhooks (C4.3).
 *
 * Webhook signature: `X-Payments-Signature: v1=<hex>`, where `<hex>` is the HMAC-SHA256, keyed
 * with the shared webhook secret, of `<timestamp>.<raw request body>`; `<timestamp>` is the
 * `X-Payments-Timestamp` header (Unix seconds). Every delivery attempt is signed afresh, so a
 * receiver can reject timestamps outside its replay window.
 */
/**
 * Local-only defaults of the provider's API key and webhook secret, used by both services when
 * `PAYMENTS_API_KEY` / `PAYMENTS_WEBHOOK_SECRET` are unset, so they work together without a
 * `.env`. Production must set its own.
 */
export const DEV_PAYMENTS_API_KEY = 'sk_test_testtix_local_only';
export const DEV_PAYMENTS_WEBHOOK_SECRET = 'whsec_testtix_local_only';

export const PAYMENT_SIGNATURE_HEADER = 'X-Payments-Signature';
export const PAYMENT_TIMESTAMP_HEADER = 'X-Payments-Timestamp';
/** 1 for the first delivery of an event, 2 for the first retry, and so on. Not signed. */
export const PAYMENT_ATTEMPT_HEADER = 'X-Payments-Attempt';
/** Version prefix of the signature value. */
export const PAYMENT_SIGNATURE_VERSION = 'v1';

/**
 * - `OPEN`: waiting for the customer to pay on the payment page.
 * - `SUCCEEDED` / `FAILED`: the customer submitted a card; the result is final.
 * - `EXPIRED`: nobody paid before `expiresAt`.
 */
export const PAYMENT_SESSION_STATUSES = ['OPEN', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export const PaymentSessionStatusSchema = z.enum(PAYMENT_SESSION_STATUSES);
export type PaymentSessionStatus = z.infer<typeof PaymentSessionStatusSchema>;

export const PAYMENT_FAILURE_CODES = ['CARD_DECLINED', 'INSUFFICIENT_FUNDS'] as const;
export const PaymentFailureCodeSchema = z.enum(PAYMENT_FAILURE_CODES);
export type PaymentFailureCode = z.infer<typeof PaymentFailureCodeSchema>;

export const PAYMENT_EVENT_TYPES = ['payment.succeeded', 'payment.failed'] as const;
export const PaymentEventTypeSchema = z.enum(PAYMENT_EVENT_TYPES);
export type PaymentEventType = z.infer<typeof PaymentEventTypeSchema>;

/**
 * What the API did with a received webhook event (C4.3), stored with it:
 *
 * - `APPLIED`: the event decided its order: it moved the unpaid order to `PROCESSING`, and a job
 *   then confirms it (`payment.succeeded`) or fails it (`payment.failed`).
 * - `IGNORED`: nothing to do, e.g. a failure for an order whose result is already known.
 * - `REFUND_DUE`: money arrived that no order can use (the order had expired, another result was
 *   already final, or the session or amount doesn't match): recorded and due a refund, never sold.
 */
export const PAYMENT_EVENT_OUTCOMES = ['APPLIED', 'IGNORED', 'REFUND_DUE'] as const;
export const PaymentEventOutcomeSchema = z
  .enum(PAYMENT_EVENT_OUTCOMES)
  .meta({ id: 'PaymentEventOutcome' });
export type PaymentEventOutcome = z.infer<typeof PaymentEventOutcomeSchema>;

const httpUrl = z.url({ protocol: /^https?$/, error: 'Must be an http:// or https:// URL' });

/** Free-form key/value pairs the caller gets back in the session and in every webhook. */
export const PaymentMetadataSchema = z
  .record(z.string().min(1).max(40), z.string().max(500))
  .refine((metadata) => Object.keys(metadata).length <= 20, 'At most 20 metadata keys');

/** `POST /sessions` on the fake payment provider. */
export const CreatePaymentSessionRequestSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  currency: z.literal(CURRENCY),
  /** Shown on the payment page, e.g. "2 tickets for Jazz Night". */
  description: z.string().trim().min(1).max(200),
  /** Where the payment page sends the customer afterwards, with `session_id` added to the query. */
  returnUrl: httpUrl,
  /** Where the provider POSTs signed payment events. */
  webhookUrl: httpUrl,
  metadata: PaymentMetadataSchema.default({}),
});
export type CreatePaymentSessionRequest = z.input<typeof CreatePaymentSessionRequestSchema>;

/** One attempt to deliver a webhook, for debugging: `GET /sessions/:id` lists them. */
export const WebhookDeliveryAttemptSchema = z.object({
  eventId: z.string(),
  attempt: z.number().int().min(1),
  sentAt: z.iso.datetime(),
  /** The receiver's HTTP status, or null when no response came (network error, timeout). */
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type WebhookDeliveryAttempt = z.infer<typeof WebhookDeliveryAttemptSchema>;

export const PaymentSessionSchema = z.object({
  id: z.string(),
  status: PaymentSessionStatusSchema,
  amountCents: z.number().int(),
  currency: z.literal(CURRENCY),
  description: z.string(),
  /** The payment page. Redirect the customer here. */
  url: z.url(),
  returnUrl: z.url(),
  webhookUrl: z.url(),
  metadata: z.record(z.string(), z.string()),
  failureCode: PaymentFailureCodeSchema.nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  webhookDeliveries: z.array(WebhookDeliveryAttemptSchema),
});
export type PaymentSession = z.infer<typeof PaymentSessionSchema>;

/** The JSON body of every webhook delivery. Deliveries of one event share its `id`. */
export const PaymentWebhookEventSchema = z.object({
  id: z.string(),
  type: PaymentEventTypeSchema,
  createdAt: z.iso.datetime(),
  data: z.object({
    sessionId: z.string(),
    status: z.enum(['SUCCEEDED', 'FAILED']),
    amountCents: z.number().int(),
    currency: z.literal(CURRENCY),
    failureCode: PaymentFailureCodeSchema.nullable(),
    metadata: z.record(z.string(), z.string()),
  }),
});
export type PaymentWebhookEvent = z.infer<typeof PaymentWebhookEventSchema>;
