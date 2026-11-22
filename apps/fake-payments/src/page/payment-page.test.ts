import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CARD_MESSAGES } from '../cards/card-form.js';
import {
  createSession,
  createTestApp,
  FakeClock,
  getSession,
  submitCard,
} from '../testing/test-app.js';

// The "no webhook" card: completes a payment without any network call.
const NO_WEBHOOK_CARD = '4000 0000 0000 0077';

describe('payment page', () => {
  let app: NestFastifyApplication;
  const clock = new FakeClock(new Date('2026-11-22T12:00:00.000Z'));

  beforeAll(async () => {
    app = await createTestApp({ clock, env: { SESSION_TTL_MINUTES: '10' } });
  });
  afterAll(() => app.close());

  it('shows the amount, description, a labelled card form and the test cards', async () => {
    const session = await createSession(app, { description: 'Tickets <for> "you"' });
    const response = await app.inject({ method: 'GET', url: `/pay/${session.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'self'; form-action 'self' http://shop.test; frame-ancestors 'none'; base-uri 'none'",
    );
    const page = response.body;
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('<title>Pay $90.00 – TestTix Pay</title>');
    expect(page).toContain('<h1>Pay $90.00</h1>');
    expect(page).toContain('Tickets &lt;for&gt; &quot;you&quot;');
    expect(page).toContain(`<form method="post" action="/pay/${session.id}" novalidate>`);
    for (const [id, label, autocomplete] of [
      ['cardNumber', 'Card number', 'cc-number'],
      ['expiry', 'Expiry date', 'cc-exp'],
      ['cvc', 'Security code', 'cc-csc'],
      ['name', 'Name on card', 'cc-name'],
    ]) {
      expect(page).toContain(`<label for="${id}">${label}</label>`);
      expect(page).toMatch(
        new RegExp(`<input id="${id}" name="${id}"[^>]*autocomplete="${autocomplete}"`),
      );
    }
    expect(page).toContain('<button type="submit">Pay $90.00</button>');
    expect(page).toContain(
      `<a href="http://shop.test/orders/o1/return?from=pay&amp;session_id=${session.id}">Cancel and return to the shop</a>`,
    );
    expect(page).toContain('4242 4242 4242 4242');
    expect(page).not.toContain('error-summary');
  });

  it('serves its stylesheet', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/pay.css' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response.body).toContain('.error-summary');
  });

  it('answers 404 with a page for an unknown session', async () => {
    const response = await app.inject({ method: 'GET', url: '/pay/ps_unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('<h1>Payment not found</h1>');
    const post = await submitCard(app, 'ps_unknown', { cardNumber: NO_WEBHOOK_CARD });
    expect(post.statusCode).toBe(404);
  });

  it('shows every problem in an error summary and next to its field', async () => {
    const session = await createSession(app);
    const response = await submitCard(app, session.id, {
      cardNumber: '4242 4242 4242 4241',
      expiry: '10/26',
      cvc: '12',
      name: 'Ada <Lovelace>',
    });

    expect(response.statusCode).toBe(400);
    const page = response.body;
    expect(page).toContain('<title>Error: Pay $90.00 – TestTix Pay</title>');
    expect(page).toContain('role="alert"');
    expect(page).toContain(`<li><a href="#cardNumber">${CARD_MESSAGES.cardNumberInvalid}</a></li>`);
    expect(page).toContain(`<li><a href="#expiry">${CARD_MESSAGES.expired}</a></li>`);
    expect(page).toContain(`<li><a href="#cvc">${CARD_MESSAGES.cvcFormat}</a></li>`);
    expect(page).not.toContain('href="#name"');
    expect(page).toMatch(
      /<input id="cardNumber"[^>]*value="4242 4242 4242 4241"[^>]*aria-describedby="cardNumber-hint cardNumber-error" aria-invalid="true"/,
    );
    // The security code is never echoed back; the name is, escaped.
    expect(page).toMatch(/<input id="cvc" name="cvc" type="text" value=""/);
    expect(page).toMatch(/<input id="name"[^>]*value="Ada &lt;Lovelace&gt;"/);
    expect(page).not.toMatch(/<input id="name"[^>]*aria-invalid/);
    expect((await getSession(app, session.id)).status).toBe('OPEN');
  });

  it('rejects a valid card number that is not a test card', async () => {
    const session = await createSession(app);
    const response = await submitCard(app, session.id, { cardNumber: '5555 5555 5555 4444' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(CARD_MESSAGES.notATestCard);
  });

  it('takes the payment once, then redirects to the shop with the session ID', async () => {
    const session = await createSession(app);
    const response = await submitCard(app, session.id, { cardNumber: NO_WEBHOOK_CARD });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      `http://shop.test/orders/o1/return?from=pay&session_id=${session.id}`,
    );
    expect(await getSession(app, session.id)).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      completedAt: clock.now().toISOString(),
      webhookDeliveries: [],
    });

    const again = await submitCard(app, session.id, { cardNumber: NO_WEBHOOK_CARD });
    expect(again.statusCode).toBe(409);
    expect(again.body).toContain('<h1>Payment complete</h1>');

    const page = await app.inject({ method: 'GET', url: `/pay/${session.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Your payment of $90.00 was successful.');
    expect(page.body).toContain('>Return to the shop</a>');
  });

  it('answers 410 once the session has expired, and takes no payment', async () => {
    const session = await createSession(app);
    clock.advance(10 * 60 * 1000);

    const page = await app.inject({ method: 'GET', url: `/pay/${session.id}` });
    expect(page.statusCode).toBe(410);
    expect(page.body).toContain('<h1>This payment link has expired</h1>');

    const post = await submitCard(app, session.id, { cardNumber: NO_WEBHOOK_CARD });
    expect(post.statusCode).toBe(410);
    expect((await getSession(app, session.id)).status).toBe('EXPIRED');
  });
});
