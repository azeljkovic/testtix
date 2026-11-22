import { randomBytes } from 'node:crypto';

import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  PROBLEM_TYPE_BLANK,
  PROBLEM_TYPES,
  ProblemDetailsSchema,
  SESSION_COOKIE,
} from '@testtix/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { USER_SPECS } from '../seed/fixtures.js';
import { seedDatabase } from '../seed/seed.js';
import { createTestSession, openBrowser, setCookieOf } from '../testing/auth.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { AuthSessionSchema } from './auth.schemas.js';
import { CurrentUser, Roles } from './auth.decorators.js';
import { SESSION_CHALLENGE } from './auth.guard.js';
import { SESSION_SLIDE_INTERVAL_MS } from './session.service.js';
import type { User } from '../generated/prisma/client.js';

const HOUR = 60 * 60 * 1000;
const TTL_MS = 168 * HOUR;
const PASSWORD = 'correct horse battery';

/** Probe routes for the guards: one for any logged-in user, one for admins, one state-changing. */
@Controller('__auth-probe')
class AuthProbeController {
  @Get('anyone')
  anyone(@CurrentUser() user: User) {
    return { userId: user.id };
  }

  @Get('admin')
  @Roles('ADMIN')
  admin(@CurrentUser() user: User) {
    return { userId: user.id };
  }

  @Post('change')
  @HttpCode(200)
  change() {
    return { changed: true };
  }
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;

function uniqueEmail(label: string): string {
  return `${label}-${randomBytes(4).toString('hex')}@example.com`;
}

function problemOf(res: request.Response) {
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  return ProblemDetailsSchema.parse(res.body);
}

async function register(email = uniqueEmail('user'), password = PASSWORD) {
  const browser = await openBrowser(app);
  const res = await browser.post('/auth/register').send({ email, password, name: 'Test User' });
  expect(res.status).toBe(201);
  return { browser, email, res };
}

beforeAll(async () => {
  app = await createIntegrationApp({
    env: { TESTTIX_TEST_MODE: 'true' },
    controllers: [AuthProbeController],
  });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  await seedDatabase(prisma, new Date());
});

afterEach(async () => {
  await clock.reset();
});

afterAll(async () => {
  await app.close();
});

describe('GET /auth/csrf', () => {
  it('sets a readable CSRF cookie and returns the same token', async () => {
    const res = await request(app.getHttpServer()).get('/auth/csrf').expect(200);
    const cookie = setCookieOf(res, CSRF_COOKIE);
    expect(res.body).toEqual({ csrfToken: cookie?.value });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toMatchObject({
      path: '/',
      samesite: 'Lax',
      'max-age': String(30 * 24 * 60 * 60),
    });
    expect(cookie?.attributes.httponly).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps an existing token and renews its cookie', async () => {
    const browser = await openBrowser(app);
    const res = await browser.agent.get('/auth/csrf').expect(200);
    expect(res.body).toEqual({ csrfToken: browser.csrfToken });
    expect(setCookieOf(res, CSRF_COOKIE)?.value).toBe(browser.csrfToken);
  });
});

describe('CSRF protection', () => {
  const body = () => ({ email: uniqueEmail('csrf'), password: PASSWORD, name: 'Csrf' });

  it('rejects a state-changing request without the header', async () => {
    const browser = await openBrowser(app);
    const res = await browser.agent.post('/auth/register').send(body());
    expect(res.status).toBe(403);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.CSRF_TOKEN_INVALID,
      status: 403,
      instance: '/auth/register',
    });
  });

  it('rejects a header that does not match the cookie', async () => {
    const browser = await openBrowser(app);
    const other = await openBrowser(app);
    const res = await browser.agent
      .post('/auth/login')
      .set(CSRF_HEADER, other.csrfToken)
      .send({ email: 'a@example.com', password: 'x' });
    expect(res.status).toBe(403);
    expect(problemOf(res).type).toBe(PROBLEM_TYPES.CSRF_TOKEN_INVALID);
  });

  it('rejects a header without the cookie', async () => {
    const { csrfToken } = await openBrowser(app);
    const res = await request(app.getHttpServer()).post('/auth/logout').set(CSRF_HEADER, csrfToken);
    expect(res.status).toBe(403);
  });

  it('does not count a CSRF failure as a validation error (guards run before the body pipe)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send({});
    expect(res.status).toBe(403);
  });

  it('answers 401, not 403, for a protected route without a session', async () => {
    const res = await request(app.getHttpServer()).post('/__auth-probe/change');
    expect(res.status).toBe(401);
  });

  it('lets a logged-in request through only with the token', async () => {
    const { browser } = await register();
    expect((await browser.agent.post('/__auth-probe/change')).status).toBe(403);
    const res = await browser.post('/__auth-probe/change');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ changed: true });
  });

  it('does not apply to the test API', async () => {
    const res = await request(app.getHttpServer())
      .post('/__test/sessions')
      .send({ role: 'CUSTOMER' });
    expect(res.status).toBe(201);
  });
});

describe('POST /auth/register', () => {
  it('creates an unverified customer, logs it in and stores an argon2id hash', async () => {
    const browser = await openBrowser(app);
    const email = uniqueEmail('Ada.Lovelace');
    const res = await browser
      .post('/auth/register')
      .send({ email: `  ${email.toUpperCase()} `, password: PASSWORD, name: '  Ada  ' });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = AuthSessionSchema.parse(res.body);
    expect(body.user).toMatchObject({
      email: email.toLowerCase(),
      name: 'Ada',
      role: 'CUSTOMER',
      emailVerified: false,
    });

    const cookie = setCookieOf(res, SESSION_COOKIE);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toMatchObject({
      path: '/',
      httponly: true,
      samesite: 'Lax',
      'max-age': String(TTL_MS / 1000),
    });
    expect(cookie?.attributes.secure).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    // Only the token's hash is stored.
    expect(sessions[0]?.tokenHash).not.toBe(cookie?.value);

    const me = await browser.agent.get('/auth/me').expect(200);
    expect(AuthSessionSchema.parse(me.body).user.id).toBe(body.user.id);
  });

  it('answers 409 email-already-registered for a taken email, whatever its case', async () => {
    const { email } = await register();
    const browser = await openBrowser(app);
    const res = await browser
      .post('/auth/register')
      .send({ email: email.toUpperCase(), password: PASSWORD, name: 'Copy' });

    expect(res.status).toBe(409);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.EMAIL_ALREADY_REGISTERED,
      errors: [{ path: 'email', code: 'email_taken' }],
    });
    expect(setCookieOf(res, SESSION_COOKIE)).toBeUndefined();
    expect(await prisma.user.count({ where: { email: email.toLowerCase() } })).toBe(1);
  });

  it('lets only one of two concurrent registrations with the same email win', async () => {
    const email = uniqueEmail('race');
    const [a, b] = await Promise.all([openBrowser(app), openBrowser(app)]);
    const results = await Promise.all(
      [a, b].map((browser) =>
        browser.post('/auth/register').send({ email, password: PASSWORD, name: 'Racer' }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a short password', { password: 'short' }, 'password'],
    ['a blank name', { name: '  ' }, 'name'],
    ['a role', { role: 'ADMIN' }, ''],
  ])('rejects %s with a validation error', async (_case, override, path) => {
    const browser = await openBrowser(app);
    const res = await browser
      .post('/auth/register')
      .send({ email: uniqueEmail('invalid'), password: PASSWORD, name: 'Val', ...override });
    expect(res.status).toBe(400);
    const problem = problemOf(res);
    expect(problem.type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
    expect(problem.errors.map((error) => error.path)).toContain(path);
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right password', async () => {
    const { email } = await register();
    const browser = await openBrowser(app);
    const res = await browser
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(AuthSessionSchema.parse(res.body).user.email).toBe(email);
    expect(setCookieOf(res, SESSION_COOKIE)?.attributes.httponly).toBe(true);
    await browser.agent.get('/auth/me').expect(200);
  });

  it.each(USER_SPECS)('logs in as the seeded $email', async ({ email, password, role }) => {
    const browser = await openBrowser(app);
    const res = await browser.post('/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(AuthSessionSchema.parse(res.body).user).toMatchObject({ email, role });
  });

  it('answers 401 invalid-credentials for a wrong password', async () => {
    const { email } = await register();
    const browser = await openBrowser(app);
    const res = await browser.post('/auth/login').send({ email, password: `${PASSWORD}!` });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(SESSION_CHALLENGE);
    expect(problemOf(res)).toMatchObject({
      type: PROBLEM_TYPES.INVALID_CREDENTIALS,
      detail: 'The email address or password is wrong.',
    });
    expect(setCookieOf(res, SESSION_COOKIE)).toBeUndefined();
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    const { email } = await register();
    const browser = await openBrowser(app);
    const wrong = await browser.post('/auth/login').send({ email, password: 'nope-nope' });
    const unknown = await browser
      .post('/auth/login')
      .send({ email: uniqueEmail('nobody'), password: 'nope-nope' });
    expect(unknown.status).toBe(401);
    const { requestId: _a, ...wrongProblem } = problemOf(wrong);
    const { requestId: _b, ...unknownProblem } = problemOf(unknown);
    expect(unknownProblem).toEqual(wrongProblem);
  });

  it('answers 401, not 500, for a scenario buyer whose hash is not argon2', async () => {
    const scenario = await request(app.getHttpServer())
      .post('/__test/seed/sold-out-event')
      .expect(201);
    const { email } = (scenario.body as { buyer: { email: string } }).buyer;
    const browser = await openBrowser(app);
    const res = await browser.post('/auth/login').send({ email, password: '!locked' });
    expect(res.status).toBe(401);
    expect(problemOf(res).type).toBe(PROBLEM_TYPES.INVALID_CREDENTIALS);
  });

  it('ends the session the browser had before', async () => {
    const { browser, email } = await register();
    const before = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    });
    expect(before.sessions).toHaveLength(1);

    await browser.post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const after = await prisma.session.findMany({ where: { userId: before.id } });
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(before.sessions[0]?.id);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const { browser, email } = await register();
    const res = await browser.post('/auth/logout');
    expect(res.status).toBe(204);
    expect(setCookieOf(res, SESSION_COOKIE)?.value).toBe('');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    });
    expect(user.sessions).toHaveLength(0);
    await browser.agent.get('/auth/me').expect(401);
  });

  it('succeeds without a session, so it can be repeated', async () => {
    const browser = await openBrowser(app);
    expect((await browser.post('/auth/logout')).status).toBe(204);
    expect((await browser.post('/auth/logout')).status).toBe(204);
  });

  it('rejects the old token after logout, even when replayed without the cookie jar', async () => {
    const { browser, res } = await register();
    const token = setCookieOf(res, SESSION_COOKIE)?.value ?? '';
    await browser.post('/auth/logout').expect(204);
    const replay = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(replay.status).toBe(401);
  });
});

describe('GET /auth/me and the auth guard', () => {
  it('answers 401 with a challenge without a session cookie', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(SESSION_CHALLENGE);
    expect(problemOf(res)).toMatchObject({ type: PROBLEM_TYPE_BLANK, status: 401 });
    expect(setCookieOf(res, SESSION_COOKIE)).toBeUndefined();
  });

  it.each(['garbage', 'a'.repeat(43)])(
    'answers 401 and clears an invalid cookie (%s)',
    async (token) => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `${SESSION_COOKIE}=${token}`);
      expect(res.status).toBe(401);
      expect(setCookieOf(res, SESSION_COOKIE)?.value).toBe('');
    },
  );

  it('loads the user on every request, so a role change applies at once', async () => {
    const { browser, res } = await register();
    const { user } = AuthSessionSchema.parse(res.body);
    await browser.agent.get('/__auth-probe/admin').expect(403);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    const admin = await browser.agent.get('/__auth-probe/admin').expect(200);
    expect(admin.body).toEqual({ userId: user.id });
  });

  it('answers 401 once the user is deleted', async () => {
    const { browser, res } = await register();
    await prisma.user.delete({ where: { id: AuthSessionSchema.parse(res.body).user.id } });
    await browser.agent.get('/auth/me').expect(401);
  });
});

describe('roles', () => {
  it('lets customers and admins reach a route for any logged-in user', async () => {
    for (const role of ['CUSTOMER', 'ADMIN'] as const) {
      const { cookie } = await createTestSession(app, { role });
      await request(app.getHttpServer())
        .get('/__auth-probe/anyone')
        .set('Cookie', cookie)
        .expect(200);
    }
  });

  it('answers 403 to a customer on an admin route, 200 to an admin and 401 to anyone else', async () => {
    const customer = await createTestSession(app, { role: 'CUSTOMER' });
    const admin = await createTestSession(app, { role: 'ADMIN' });

    const denied = await request(app.getHttpServer())
      .get('/__auth-probe/admin')
      .set('Cookie', customer.cookie);
    expect(denied.status).toBe(403);
    expect(problemOf(denied)).toMatchObject({
      type: PROBLEM_TYPE_BLANK,
      detail: 'This endpoint requires the ADMIN role.',
    });

    const allowed = await request(app.getHttpServer())
      .get('/__auth-probe/admin')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(allowed.body).toEqual({ userId: admin.user.id });
    await request(app.getHttpServer()).get('/__auth-probe/admin').expect(401);
  });
});

describe('session expiry (server clock)', () => {
  it('expires an unused session after the TTL and deletes it', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser, email } = await register();
    const login = await browser.agent.get('/auth/me').expect(200);
    expect(AuthSessionSchema.parse(login.body).session.expiresAt).toBe('2026-12-08T10:00:00.000Z');

    await clock.advanceBy(TTL_MS - 1);
    await browser.agent.get('/auth/me').expect(200);

    // That request moved the expiry to (now + TTL); go past it.
    await clock.advanceBy(TTL_MS);
    const expired = await browser.agent.get('/auth/me');
    expect(expired.status).toBe(401);
    expect(problemOf(expired).detail).toBe('Your session has expired or was ended. Log in again.');
    expect(setCookieOf(expired, SESSION_COOKIE)?.value).toBe('');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    });
    expect(user.sessions).toHaveLength(0);
  });

  it('expires exactly at expiresAt', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser } = await register();
    await clock.advanceBy(TTL_MS);
    await browser.agent.get('/auth/me').expect(401);
  });

  it('slides the expiry forward on use and re-sends the cookie', async () => {
    await clock.freezeAt(new Date('2026-12-01T10:00:00Z'));
    const { browser } = await register();

    // Within the slide interval nothing changes, and no cookie is sent.
    await clock.advanceBy(SESSION_SLIDE_INTERVAL_MS - 1);
    const same = await browser.agent.get('/auth/me').expect(200);
    expect(AuthSessionSchema.parse(same.body).session.expiresAt).toBe('2026-12-08T10:00:00.000Z');
    expect(setCookieOf(same, SESSION_COOKIE)).toBeUndefined();

    await clock.advanceBy(6 * 24 * HOUR);
    const slid = await browser.agent.get('/auth/me').expect(200);
    expect(AuthSessionSchema.parse(slid.body).session.expiresAt).toBe('2026-12-14T10:00:59.999Z');
    expect(setCookieOf(slid, SESSION_COOKIE)?.attributes['max-age']).toBe(String(TTL_MS / 1000));

    // 12 days after login, still logged in thanks to the slide.
    await clock.advanceBy(6 * 24 * HOUR);
    await browser.agent.get('/auth/me').expect(200);
  });
});

describe('cookie attributes', () => {
  it('marks the cookies Secure when COOKIE_SECURE=true', async () => {
    const secureApp = await createIntegrationApp({ env: { COOKIE_SECURE: 'true' } });
    try {
      const csrf = await request(secureApp.getHttpServer()).get('/auth/csrf').expect(200);
      expect(setCookieOf(csrf, CSRF_COOKIE)?.attributes.secure).toBe(true);
      const token = (csrf.body as { csrfToken: string }).csrfToken;
      const res = await request(secureApp.getHttpServer())
        .post('/auth/login')
        .set('Cookie', `${CSRF_COOKIE}=${token}`)
        .set(CSRF_HEADER, token)
        .send({ email: 'customer@testtix.test', password: 'TestTix-customer-1' });
      expect(res.status).toBe(200);
      expect(setCookieOf(res, SESSION_COOKIE)?.attributes.secure).toBe(true);
    } finally {
      await secureApp.close();
    }
  });
});
