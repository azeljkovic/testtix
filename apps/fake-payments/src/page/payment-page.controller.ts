import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { readCardForm, validateCardForm } from '../cards/card-form.js';
import { type Clock, CLOCK } from '../infra/clock.js';
import {
  PaymentSessionsService,
  type SessionRecord,
} from '../sessions/payment-sessions.service.js';
import { PAY_CSS } from './styles.js';
import { renderClosedSession, renderNotFound, renderPaymentForm } from './views.js';

/**
 * The hosted payment page the customer is redirected to. Plain server-rendered HTML forms, no
 * JavaScript. Expected outcomes (bad input, unknown or finished session) are pages with the
 * matching status, never JSON errors.
 */
@Controller()
export class PaymentPageController {
  constructor(
    private readonly sessions: PaymentSessionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('pay/:id')
  async show(@Param('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    const session = this.sessions.find(id);
    if (session === undefined) {
      await sendPage(reply, HttpStatus.NOT_FOUND, renderNotFound());
      return;
    }
    const returnUrl = this.sessions.returnUrlFor(session);
    if (session.status === 'OPEN') {
      await sendPage(
        reply,
        HttpStatus.OK,
        renderPaymentForm({ session, cancelUrl: returnUrl }),
        session,
      );
      return;
    }
    const status = session.status === 'EXPIRED' ? HttpStatus.GONE : HttpStatus.OK;
    await sendPage(reply, status, renderClosedSession(session, returnUrl), session);
  }

  @Post('pay/:id')
  async submit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const session = this.sessions.find(id);
    if (session === undefined) {
      await sendPage(reply, HttpStatus.NOT_FOUND, renderNotFound());
      return;
    }
    const returnUrl = this.sessions.returnUrlFor(session);
    if (session.status !== 'OPEN') {
      await this.sendClosed(reply, session, returnUrl);
      return;
    }

    const form = validateCardForm(readCardForm(body), this.clock.now());
    if (!form.ok) {
      const page = renderPaymentForm({ session, cancelUrl: returnUrl, ...form });
      await sendPage(reply, HttpStatus.BAD_REQUEST, page, session);
      return;
    }

    const result = this.sessions.pay(id, form.card);
    if (result.kind !== 'COMPLETED') {
      // Unreachable while `pay` runs synchronously right after the check above; kept for safety.
      await this.sendClosed(reply, session, returnUrl);
      return;
    }
    // 303: the browser follows with a GET, so a reload doesn't resubmit the form.
    await reply.status(HttpStatus.SEE_OTHER).header('Location', returnUrl).send();
  }

  @Get('assets/pay.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  stylesheet(): string {
    return PAY_CSS;
  }

  /** A second submission (double click, back button) or a submission after expiry. */
  private async sendClosed(reply: FastifyReply, session: SessionRecord, returnUrl: string) {
    const status = session.status === 'EXPIRED' ? HttpStatus.GONE : HttpStatus.CONFLICT;
    await sendPage(reply, status, renderClosedSession(session, returnUrl), session);
  }
}

async function sendPage(
  reply: FastifyReply,
  status: number,
  page: string,
  session?: SessionRecord,
): Promise<void> {
  // The form posts to this origin and is then redirected to the shop, which `form-action` must
  // allow too (browsers check the redirect target).
  const formAction = session ? `'self' ${new URL(session.returnUrl).origin}` : `'self'`;
  await reply
    .status(status)
    .headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(page);
}
