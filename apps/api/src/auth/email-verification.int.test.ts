import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPES, ProblemDetailsSchema } from '@testtix/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { type Browser, createTestSession, openBrowser } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { type Email, findEmails, linkIn, waitForEmail } from '../testing/integration/mailpit.js';
import { AuthSessionSchema } from './auth.schemas.js';

const WEB_BASE_URL = 'https://shop.example.test';
const SUBJECT = 'Verify your email address';
const HOUR = 60 * 60 * 1000;

let app: NestFastifyApplication;
let clock: ClockService;
let prisma: PrismaService;

function uniqueEmail(label: string): string {
  return `${label}-${randomBytes(4).toString('hex')}@example.com`;
}

function problemOf(res: request.Response) {
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  return ProblemDetailsSchema.parse(res.body);
}

function tokenIn(email: Email): string {
  const link = linkIn(email, `${WEB_BASE_URL}/verify-email?`);
  const token = link.searchParams.get('token');
  if (token === null) throw new Error('No token in the verification link');
  return token;
}

async function register(email = uniqueEmail('user')) {
  const browser = await openBrowser(app);
  await browser
    .post('/auth/register')
    .send({ email, password: 'correct horse battery', name: 'Ada Lovelace' })
    .expect(201);
  return { browser, email };
}

function verify(browser: Browser, token: string) {
  return browser.post('/auth/verify-email').send({ token });
}

async function emailVerified(browser: Browser): Promise<boolean> {
  const res = await browser.agent.get('/auth/me').expect(200);
  return AuthSessionSchema.parse(res.body).user.emailVerified;
}

beforeAll(async () => {
  app = await createIntegrationApp({
    env: { TESTTIX_TEST_MODE: 'true', WEB_BASE_URL, EMAIL_VERIFICATION_TTL_HOURS: '24' },
  });
  clock = app.get(ClockService);
  prisma = app.get(PrismaService);
});

afterEach(async () => {
  await clock.reset();
});

afterAll(async () => {
  await app.close();
});

describe('verification email', () => {
  it('is sent on registration, and its link verifies the account', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    expect(await emailVerified(browser)).toBe(false);

    const mail = await waitForEmail(email, SUBJECT);
    expect(mail.from).toBe('no-reply@testtix.test');
    expect(mail.to).toEqual([email]);
    expect(mail.date).toBe('2026-12-01T10:00:00Z');
    expect(mail.text).toContain('Hi Ada Lovelace,');
    expect(mail.text).toContain('The link works for 24 hours.');
    const token = tokenIn(mail);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mail.html).toContain(`href="${WEB_BASE_URL}/verify-email?token&#x3D;${token}"`);

    await verify(browser, token).expect(204);
    expect(await emailVerified(browser)).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toEqual(new Date('2026-12-01T10:00:00Z'));
  });

  it('stores only a hash of the token', async () => {
    const { email } = await register();
    const token = tokenIn(await waitForEmail(email, SUBJECT));
    const row = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { user: { email } },
    });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(token);
  });
});

describe('POST /auth/verify-email', () => {
  it('works without a session, from another browser', async () => {
    const { browser, email } = await register();
    const token = tokenIn(await waitForEmail(email, SUBJECT));
    const otherBrowser = await openBrowser(app);
    await verify(otherBrowser, token).expect(204);
    expect(await emailVerified(browser)).toBe(true);
  });

  it('succeeds again for a link that was already used, keeping the first verification time', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    const token = tokenIn(await waitForEmail(email, SUBJECT));
    await verify(browser, token).expect(204);
    await clock.advanceBy(HOUR);
    await verify(browser, token).expect(204);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toEqual(new Date('2026-12-01T10:00:00Z'));
  });

  it('expires the link after EMAIL_VERIFICATION_TTL_HOURS', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    const token = tokenIn(await waitForEmail(email, SUBJECT));

    await clock.advanceBy(24 * HOUR);
    const res = await verify(browser, token).expect(400);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.VERIFICATION_TOKEN_EXPIRED,
      status: 400,
    });
    expect(await emailVerified(browser)).toBe(false);
  });

  it('still accepts the link a moment before it expires', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    const token = tokenIn(await waitForEmail(email, SUBJECT));
    await clock.advanceBy(24 * HOUR - 1);
    await verify(browser, token).expect(204);
  });

  it.each([
    ['an unknown token', randomBytes(32).toString('base64url')],
    ['a malformed token', 'not-a-token'],
  ])('rejects %s with verification-token-invalid', async (_label, token) => {
    const browser = await openBrowser(app);
    const res = await verify(browser, token).expect(400);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.VERIFICATION_TOKEN_INVALID,
      status: 400,
      errors: [],
    });
  });

  it('rejects an empty token as a validation error', async () => {
    const browser = await openBrowser(app);
    const res = await verify(browser, '').expect(400);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.VALIDATION_ERROR,
      errors: [{ path: 'token' }],
    });
  });

  it('requires a CSRF token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'whatever' })
      .expect(403);
    expect(problemOf(res).type).toBe(PROBLEM_TYPES.CSRF_TOKEN_INVALID);
  });
});

describe('POST /auth/verify-email/resend', () => {
  it('sends a new link and makes the old one stop working', async () => {
    const { browser, email } = await register();
    const first = await waitForEmail(email, SUBJECT);
    const oldToken = tokenIn(first);

    await browser.post('/auth/verify-email/resend').expect(204);
    const newToken = tokenIn(await waitForEmail(email, SUBJECT, { excluding: [first] }));
    expect(newToken).not.toBe(oldToken);

    const res = await verify(browser, oldToken).expect(400);
    expect(problemOf(res).type).toBe(PROBLEM_TYPES.VERIFICATION_TOKEN_INVALID);
    await verify(browser, newToken).expect(204);
    expect(await emailVerified(browser)).toBe(true);
  });

  it('gives an expired link a fresh expiry', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    const first = await waitForEmail(email, SUBJECT);
    await clock.advanceBy(30 * HOUR);

    await browser.post('/auth/verify-email/resend').expect(204);
    const token = tokenIn(await waitForEmail(email, SUBJECT, { excluding: [first] }));
    await clock.advanceBy(23 * HOUR);
    await verify(browser, token).expect(204);
  });

  it('works for a user created through the test API, which gets no email until it asks', async () => {
    const email = uniqueEmail('session');
    const session = await createTestSession(app, {
      role: 'CUSTOMER',
      email,
      emailVerified: false,
    });
    expect(await findEmails(email)).toEqual([]);

    await request(app.getHttpServer())
      .post('/auth/verify-email/resend')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(204);
    const token = tokenIn(await waitForEmail(email, SUBJECT));
    const browser = await openBrowser(app);
    await verify(browser, token).expect(204);
  });

  it('answers 409 email-already-verified for a verified user, and sends nothing', async () => {
    const email = uniqueEmail('verified');
    const session = await createTestSession(app, { role: 'CUSTOMER', email });
    const res = await request(app.getHttpServer())
      .post('/auth/verify-email/resend')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(409);
    expect(problemOf(res).type).toBe(PROBLEM_TYPES.EMAIL_ALREADY_VERIFIED);
    expect(await findEmails(email)).toEqual([]);
  });

  it('requires a session', async () => {
    const browser = await openBrowser(app);
    const res = await browser.post('/auth/verify-email/resend').expect(401);
    expect(problemOf(res).status).toBe(401);
  });
});

describe('when the SMTP server is unreachable', () => {
  let brokenApp: NestFastifyApplication;
  let closedPort: number;

  beforeAll(async () => {
    // Bind a port, then close it: nothing listens there, so connections are refused at once.
    const server: Server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    closedPort = typeof address === 'object' && address !== null ? address.port : 0;
    await new Promise((resolve) => server.close(resolve));
    brokenApp = await createIntegrationApp({
      env: { SMTP_URL: `smtp://127.0.0.1:${String(closedPort)}` },
    });
  });

  afterAll(async () => {
    await brokenApp.close();
  });

  it('still registers the user, and the resend answers 503', async () => {
    const browser = await openBrowser(brokenApp);
    const email = uniqueEmail('nosmtp');
    const res = await browser
      .post('/auth/register')
      .send({ email, password: 'correct horse battery', name: 'Ada' })
      .expect(201);
    expect(AuthSessionSchema.parse(res.body).user.emailVerified).toBe(false);

    const resend = await browser.post('/auth/verify-email/resend').expect(503);
    expect(problemOf(resend).status).toBe(503);
  });
});
