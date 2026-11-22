import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  PROBLEM_TYPES,
  ProblemDetailsSchema,
  SESSION_COOKIE,
} from '@testtix/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthSessionSchema } from '../../auth/auth.schemas.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { setCookieOf } from '../../testing/auth.js';
import { createIntegrationApp } from '../../testing/integration/integration-app.js';
import { TestSessionResponseSchema } from './test-sessions.schemas.js';

let app: NestFastifyApplication;

function createSession(body: object) {
  return request(app.getHttpServer()).post('/__test/sessions').send(body);
}

beforeAll(async () => {
  app = await createIntegrationApp({
    env: { TESTTIX_TEST_MODE: 'true', TEST_API_KEY: 'integration-test-key-0123' },
  });
});

afterAll(async () => {
  await app.close();
});

describe('POST /__test/sessions', () => {
  it('creates a verified customer with a random email and a usable session', async () => {
    const res = await createSession({ role: 'CUSTOMER' });
    expect(res.status).toBe(201);
    const body = TestSessionResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ role: 'CUSTOMER', emailVerified: true });
    expect(body.user.email).toMatch(/^user-[0-9a-f]{8}@session\.testtix\.test$/);
    expect(body.user.name).toMatch(/^Test Customer [0-9a-f]{8}$/);
    expect(body.cookie).toBe(
      `${SESSION_COOKIE}=${body.session.token}; ${CSRF_COOKIE}=${body.csrfToken}`,
    );
    expect(setCookieOf(res, SESSION_COOKIE)?.value).toBe(body.session.token);
    expect(setCookieOf(res, CSRF_COOKIE)?.value).toBe(body.csrfToken);

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', body.cookie);
    expect(me.status).toBe(200);
    expect(AuthSessionSchema.parse(me.body).user.id).toBe(body.user.id);

    // The returned CSRF token works for state-changing requests.
    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', body.cookie)
      .set(CSRF_HEADER, body.csrfToken);
    expect(logout.status).toBe(204);
  });

  it('creates an admin, and needs no X-Test-Key even when the server has one', async () => {
    const res = await createSession({ role: 'ADMIN' });
    expect(res.status).toBe(201);
    const { user } = TestSessionResponseSchema.parse(res.body);
    expect(user.role).toBe('ADMIN');
    expect(user.name).toMatch(/^Test Admin /);
  });

  it('uses the given email, name and verification state', async () => {
    const res = await createSession({
      role: 'CUSTOMER',
      email: ' Pat@Example.com ',
      name: 'Pat',
      emailVerified: false,
    });
    expect(res.status).toBe(201);
    expect(TestSessionResponseSchema.parse(res.body).user).toMatchObject({
      email: 'pat@example.com',
      name: 'Pat',
      emailVerified: false,
    });
  });

  it('answers 409 when the email is taken', async () => {
    await createSession({ role: 'CUSTOMER', email: 'taken@example.com' }).expect(201);
    const res = await createSession({ role: 'ADMIN', email: 'TAKEN@example.com' });
    expect(res.status).toBe(409);
    expect(ProblemDetailsSchema.parse(res.body).type).toBe(PROBLEM_TYPES.EMAIL_ALREADY_REGISTERED);
  });

  it('creates a user who can log in with the given password', async () => {
    const created = TestSessionResponseSchema.parse(
      (await createSession({ role: 'CUSTOMER', password: 'secret-password' })).body,
    );
    const agent = request.agent(app.getHttpServer());
    const { csrfToken } = (await agent.get('/auth/csrf')).body as { csrfToken: string };
    const login = await agent
      .post('/auth/login')
      .set(CSRF_HEADER, csrfToken)
      .send({ email: created.user.email, password: 'secret-password' });
    expect(login.status).toBe(200);
  });

  it('creates a user without a password by default, who cannot log in', async () => {
    const created = TestSessionResponseSchema.parse(
      (await createSession({ role: 'CUSTOMER' })).body,
    );
    const user = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(user.passwordHash).toBe('!locked');
  });

  it.each([
    ['no role', {}],
    ['an unknown role', { role: 'ROOT' }],
    ['an unknown field', { role: 'CUSTOMER', admin: true }],
    ['a short password', { role: 'CUSTOMER', password: 'short' }],
  ])('rejects %s', async (_case, body) => {
    const res = await createSession(body);
    expect(res.status).toBe(400);
    expect(ProblemDetailsSchema.parse(res.body).type).toBe(PROBLEM_TYPES.VALIDATION_ERROR);
  });
});

describe('POST /__test/sessions with test mode off', () => {
  it('is a plain 404', async () => {
    const plainApp = await createIntegrationApp();
    try {
      await request(plainApp.getHttpServer())
        .post('/__test/sessions')
        .send({ role: 'ADMIN' })
        .expect(404);
    } finally {
      await plainApp.close();
    }
  });
});
