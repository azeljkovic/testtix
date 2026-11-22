import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  CURRENCY,
  type CreatePaymentSessionRequestSchema,
  type PaymentFailureCode,
  type PaymentSession,
  type PaymentSessionStatus,
  type PaymentWebhookEvent,
  type WebhookDeliveryAttempt,
} from '@testtix/shared';
import type { z } from 'zod';

import type { TestCard } from '../cards/test-cards.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { type Clock, CLOCK } from '../infra/clock.js';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.js';

/** How long a finished or expired session stays readable before it is forgotten. */
export const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

export type CreateSessionInput = z.output<typeof CreatePaymentSessionRequestSchema>;

export interface SessionRecord {
  id: string;
  status: PaymentSessionStatus;
  amountCents: number;
  description: string;
  returnUrl: string;
  webhookUrl: string;
  metadata: Record<string, string>;
  failureCode: PaymentFailureCode | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  webhookDeliveries: WebhookDeliveryAttempt[];
}

export type PayResult =
  | { kind: 'NOT_FOUND' }
  /** Already paid, failed or expired: the form can't be submitted again. */
  | { kind: 'NOT_OPEN'; session: SessionRecord }
  | { kind: 'COMPLETED'; session: SessionRecord };

/**
 * Payment sessions, kept in memory: the provider is a test double, so a restart forgetting them
 * is acceptable (documented). Node runs one request at a time between awaits, and nothing here
 * awaits, so "check the status, then change it" can't interleave with another request.
 */
@Injectable()
export class PaymentSessionsService {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  create(input: CreateSessionInput): SessionRecord {
    const now = this.clock.now();
    this.prune(now);
    const session: SessionRecord = {
      id: `ps_${randomBytes(18).toString('base64url')}`,
      status: 'OPEN',
      amountCents: input.amountCents,
      description: input.description,
      returnUrl: input.returnUrl,
      webhookUrl: input.webhookUrl,
      metadata: input.metadata,
      failureCode: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlMs),
      completedAt: null,
      webhookDeliveries: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** The session with its status brought up to date (an unpaid session past `expiresAt` expires). */
  find(id: string): SessionRecord | undefined {
    const session = this.sessions.get(id);
    if (session === undefined) return undefined;
    if (session.status === 'OPEN' && this.clock.now() >= session.expiresAt) {
      session.status = 'EXPIRED';
    }
    return session;
  }

  /** Charges `card`: records the result and sends (or deliberately doesn't send) the webhook. */
  pay(id: string, card: TestCard): PayResult {
    const session = this.find(id);
    if (session === undefined) return { kind: 'NOT_FOUND' };
    if (session.status !== 'OPEN') return { kind: 'NOT_OPEN', session };

    const now = this.clock.now();
    session.status = card.failureCode === null ? 'SUCCEEDED' : 'FAILED';
    session.failureCode = card.failureCode;
    session.completedAt = now;

    const event = this.eventFor(session, now);
    const record = (attempt: WebhookDeliveryAttempt) => session.webhookDeliveries.push(attempt);
    switch (card.webhook) {
      case 'NORMAL':
        this.webhooks.deliver(session.webhookUrl, event, record);
        break;
      case 'DELAYED':
        this.webhooks.deliver(session.webhookUrl, event, record, this.config.delayedWebhookMs);
        break;
      case 'DUPLICATE':
        this.webhooks.deliver(session.webhookUrl, event, record);
        this.webhooks.deliver(session.webhookUrl, event, record);
        break;
      case 'NONE':
        break;
    }
    return { kind: 'COMPLETED', session };
  }

  toView(session: SessionRecord): PaymentSession {
    return {
      id: session.id,
      status: session.status,
      amountCents: session.amountCents,
      currency: CURRENCY,
      description: session.description,
      url: this.pageUrl(session),
      returnUrl: session.returnUrl,
      webhookUrl: session.webhookUrl,
      metadata: session.metadata,
      failureCode: session.failureCode,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      webhookDeliveries: [...session.webhookDeliveries],
    };
  }

  pageUrl(session: SessionRecord): string {
    return `${this.config.publicBaseUrl}/pay/${session.id}`;
  }

  /** The merchant's return URL with `session_id` added to its query. */
  returnUrlFor(session: SessionRecord): string {
    const url = new URL(session.returnUrl);
    url.searchParams.set('session_id', session.id);
    return url.toString();
  }

  private eventFor(session: SessionRecord, now: Date): PaymentWebhookEvent {
    const succeeded = session.status === 'SUCCEEDED';
    return {
      id: `evt_${randomBytes(18).toString('base64url')}`,
      type: succeeded ? 'payment.succeeded' : 'payment.failed',
      createdAt: now.toISOString(),
      data: {
        sessionId: session.id,
        status: succeeded ? 'SUCCEEDED' : 'FAILED',
        amountCents: session.amountCents,
        currency: CURRENCY,
        failureCode: session.failureCode,
        metadata: session.metadata,
      },
    };
  }

  private prune(now: Date): void {
    for (const [id, session] of this.sessions) {
      if (now.getTime() - session.expiresAt.getTime() > SESSION_RETENTION_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
