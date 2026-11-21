import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ProblemDetailsSchema } from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, down, hangs, type TestAppOptions } from './testing/test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class ProbeBodyDto extends createZodDto(
  z.object({ name: z.string().min(2), quantity: z.number().int().min(1) }),
) {}

/** Test-only routes that exercise the global validation pipe and error filter. */
@Controller('__probe')
class ProbeController {
  @Post('echo')
  echo(@Body() body: ProbeBodyDto) {
    return body;
  }

  @Get('crash')
  crash(): never {
    throw new Error('database password is hunter2');
  }
}

let app: NestFastifyApplication | undefined;

async function start(options?: TestAppOptions): Promise<NestFastifyApplication> {
  app = await createTestApp({ controllers: [ProbeController], ...options });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function expectProblem(body: unknown, status: number, requestId: string | undefined) {
  const problem = ProblemDetailsSchema.parse(body);
  expect(problem.status).toBe(status);
  expect(problem.requestId).toBe(requestId);
  return problem;
}

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request((await start()).getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('stays 200 while dependencies are down', async () => {
    const res = await request((await start({ database: down, redis: down })).getHttpServer()).get(
      '/health',
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every dependency is up', async () => {
    const res = await request((await start()).getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it.each([
    ['database', { database: down }, { database: 'down', redis: 'up' }],
    ['redis', { redis: down }, { database: 'up', redis: 'down' }],
    ['both', { database: down, redis: down }, { database: 'down', redis: 'down' }],
  ])('returns 503 when %s is down', async (_label, fakes, expected) => {
    const res = await request((await start(fakes)).getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: { status: expected.database }, redis: { status: expected.redis } },
    });
  });

  it('reports a dependency that does not answer within the timeout as down', async () => {
    const started = performance.now();
    const res = await request(
      (await start({ redis: hangs, env: { HEALTH_CHECK_TIMEOUT_MS: '50' } })).getHttpServer(),
    ).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ checks: { redis: { status: 'down' } } });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('request IDs', () => {
  it('generates a UUID and returns it in X-Request-Id', async () => {
    const res = await request((await start()).getHttpServer()).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('reuses a well-formed X-Request-Id from the caller', async () => {
    const res = await request((await start()).getHttpServer())
      .get('/health')
      .set('X-Request-Id', 'my-test.42');
    expect(res.headers['x-request-id']).toBe('my-test.42');
  });

  it.each([
    ['contains spaces', 'two words'],
    ['is too long', 'x'.repeat(129)],
    ['contains a backslash', 'a\\b'],
  ])('replaces an incoming ID that %s', async (_label, incoming) => {
    const res = await request((await start()).getHttpServer())
      .get('/health')
      .set('X-Request-Id', incoming);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('error responses', () => {
  it('returns problem details for an unknown route', async () => {
    const res = await request((await start()).getHttpServer()).get('/no-such-route?x=1');
    expect(res.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(expectProblem(res.body, 404, res.headers['x-request-id'])).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Cannot GET /no-such-route?x=1',
      instance: '/no-such-route',
      requestId: res.headers['x-request-id'],
      errors: [],
    });
  });

  it('returns field errors when the body fails validation', async () => {
    const res = await request((await start()).getHttpServer())
      .post('/__probe/echo')
      .send({ name: 'x', quantity: '2' });
    const problem = expectProblem(res.body, 400, res.headers['x-request-id']);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(problem.type).toBe('urn:testtix:problem:validation-error');
    expect(problem.errors.map((error) => [error.path, error.code])).toEqual([
      ['name', 'too_small'],
      ['quantity', 'invalid_type'],
    ]);
  });

  it('passes a valid body through', async () => {
    const res = await request((await start()).getHttpServer())
      .post('/__probe/echo')
      .send({ name: 'ok', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'ok', quantity: 2 });
  });

  it('returns problem details with a request ID for malformed JSON', async () => {
    const res = await request((await start()).getHttpServer())
      .post('/__probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(expectProblem(res.body, 400, res.headers['x-request-id']).title).toBe('Bad Request');
  });

  it('hides the message of an unexpected error', async () => {
    const res = await request((await start()).getHttpServer()).get('/__probe/crash');
    const problem = expectProblem(res.body, 500, res.headers['x-request-id']);
    expect(problem.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

describe('OpenAPI', () => {
  it('serves the spec at /openapi.json', async () => {
    const res = await request((await start()).getHttpServer()).get('/openapi.json');
    expect(res.status).toBe(200);
    const spec = res.body as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/health', '/health/ready', '/metrics']),
    );
    expect(Object.keys(spec.paths['/health/ready']?.get?.responses ?? {})).toEqual([
      '200',
      '503',
      'default',
    ]);
    expect(spec.paths['/health']?.get?.responses.default).toEqual({
      description: expect.any(String) as string,
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    });
    expect(spec.components.schemas).toHaveProperty('ProblemDetails');
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await request((await start()).getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('TestTix API docs');
  });
});

describe('GET /metrics', () => {
  it('exposes default process metrics in Prometheus format', async () => {
    const res = await request((await start()).getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('# TYPE process_cpu_user_seconds_total counter');
    expect(res.text).toContain('nodejs_eventloop_lag_seconds');
  });
});

describe('headers', () => {
  it('does not advertise the framework', async () => {
    const res = await request((await start()).getHttpServer()).get('/health');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });
});
