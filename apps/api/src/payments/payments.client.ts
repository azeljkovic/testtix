import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePaymentSessionRequest,
  CreatePaymentSessionRequestSchema,
  type PaymentSession,
  PaymentSessionSchema,
} from '@testtix/shared';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/** The provider couldn't be reached, timed out, refused the request or answered nonsense. */
export class PaymentProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PaymentProviderError';
  }
}

/**
 * Talks to the payment provider (`apps/fake-payments`, contract in `@testtix/shared`). Every call
 * has a timeout (`PAYMENTS_TIMEOUT_MS`) and throws `PaymentProviderError` on any failure, so
 * callers can answer 503 without knowing what went wrong.
 */
@Injectable()
export class PaymentsClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** `POST /sessions`: a payment page for `request.amountCents`. */
  async createSession(request: CreatePaymentSessionRequest): Promise<PaymentSession> {
    const { baseUrl, apiKey, timeoutMs } = this.config.payments;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(CreatePaymentSessionRequestSchema.parse(request)),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PaymentProviderError(`POST /sessions failed: ${messageOf(err)}`, { cause: err });
    }
    if (!response.ok) {
      // Drain the body so the connection can be reused.
      await response.text().catch(() => undefined);
      throw new PaymentProviderError(`POST /sessions answered ${String(response.status)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new PaymentProviderError(`POST /sessions answered invalid JSON: ${messageOf(err)}`, {
        cause: err,
      });
    }
    const session = PaymentSessionSchema.safeParse(body);
    if (!session.success) {
      throw new PaymentProviderError('POST /sessions answered an unexpected body', {
        cause: session.error,
      });
    }
    return session.data;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
