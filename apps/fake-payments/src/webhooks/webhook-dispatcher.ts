import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  PAYMENT_ATTEMPT_HEADER,
  type PaymentWebhookEvent,
  type WebhookDeliveryAttempt,
} from '@testtix/shared';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { type Clock, CLOCK } from '../infra/clock.js';
import { retryDelayMs } from './backoff.js';
import { signatureHeaders } from './signature.js';

export type AttemptListener = (attempt: WebhookDeliveryAttempt) => void;

/**
 * Delivers webhook events with HTTP POST. A delivery succeeds on any 2xx response; anything else
 * (another status, a redirect, a network error, no response within `WEBHOOK_TIMEOUT_MS`) is
 * retried with exponential backoff until `WEBHOOK_MAX_ATTEMPTS`. Each attempt carries a fresh
 * timestamp and signature.
 *
 * Pending deliveries live in memory only: a restart drops them, like the sessions themselves.
 */
@Injectable()
export class WebhookDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly inFlight = new Set<AbortController>();
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Starts delivering `event` to `url` after `delayMs`. Reports every attempt to `onAttempt`. */
  deliver(url: string, event: PaymentWebhookEvent, onAttempt: AttemptListener, delayMs = 0): void {
    const body = JSON.stringify(event);
    this.later(delayMs, () => this.attempt({ url, eventId: event.id, body, onAttempt }, 1));
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.inFlight) controller.abort(new Error('Shutting down'));
  }

  private later(delayMs: number, run: () => Promise<void>): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void run();
    }, delayMs);
    this.timers.add(timer);
  }

  private async attempt(delivery: Delivery, attempt: number): Promise<void> {
    if (this.stopped) return;
    const { timeoutMs, maxAttempts, retryBaseMs } = this.config.webhook;
    const sentAt = this.clock.now();
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timeout = setTimeout(() => {
      controller.abort(new Error(`No response within ${timeoutMs} ms`));
    }, timeoutMs);

    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TestTix-FakePayments/1.0',
          [PAYMENT_ATTEMPT_HEADER]: String(attempt),
          ...signatureHeaders(this.config.webhookSecret, delivery.body, sentAt),
        },
        body: delivery.body,
        // A redirect is not a delivery: real providers don't follow them either.
        redirect: 'manual',
        signal: controller.signal,
      });
      statusCode = response.status;
      await response.body?.cancel();
    } catch (err) {
      error = describe(err);
    } finally {
      clearTimeout(timeout);
      this.inFlight.delete(controller);
    }

    delivery.onAttempt({
      eventId: delivery.eventId,
      attempt,
      sentAt: sentAt.toISOString(),
      statusCode,
      error,
    });
    const context = { eventId: delivery.eventId, attempt, statusCode, error };
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
      this.logger.log(context, 'Webhook delivered');
      return;
    }
    if (attempt >= maxAttempts) {
      this.logger.warn(context, 'Webhook delivery failed; giving up');
      return;
    }
    const delayMs = retryDelayMs(attempt + 1, retryBaseMs);
    this.logger.warn({ ...context, retryInMs: delayMs }, 'Webhook delivery failed; will retry');
    this.later(delayMs, () => this.attempt(delivery, attempt + 1));
  }
}

interface Delivery {
  url: string;
  eventId: string;
  body: string;
  onAttempt: AttemptListener;
}

/** A short reason for a failed fetch, e.g. "ECONNREFUSED" or "No response within 5000 ms". */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // fetch reports every network failure as "fetch failed"; the cause says what happened.
  const cause: unknown = err.cause;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
  ) {
    return cause.code;
  }
  return cause instanceof Error ? cause.message : err.message;
}
