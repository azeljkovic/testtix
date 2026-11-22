import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CSRF_HEADER, type Role } from '@testtix/shared';
import request, { type Response } from 'supertest';

type TestAgent = ReturnType<typeof request.agent>;

/**
 * A supertest agent with a cookie jar and a CSRF token: behaves like one browser. Its cookie jar
 * keeps the session cookie between requests; send `csrfToken` in `X-CSRF-Token` on state-changing
 * requests (`browser.post(path)` does).
 */
export interface Browser {
  agent: TestAgent;
  csrfToken: string;
  post: (path: string) => request.Test;
}

/** Opens a "browser" and fetches its CSRF token (`GET /auth/csrf`). */
export async function openBrowser(app: NestFastifyApplication): Promise<Browser> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.get('/auth/csrf').expect(200);
  const { csrfToken } = res.body as { csrfToken: string };
  return { agent, csrfToken, post: (path) => agent.post(path).set(CSRF_HEADER, csrfToken) };
}

export interface TestSession {
  /** `Cookie` header with the session and CSRF cookies. */
  cookie: string;
  csrfToken: string;
  user: { id: string; email: string; role: Role };
}

/** Creates a user with `role` and logs it in through `POST /__test/sessions` (test mode only). */
export async function createTestSession(
  app: NestFastifyApplication,
  body: { role: Role } & Record<string, unknown>,
): Promise<TestSession> {
  const res = await request(app.getHttpServer()).post('/__test/sessions').send(body).expect(201);
  return res.body as TestSession;
}

export interface SetCookie {
  value: string;
  /** Lower-cased attribute names → values (`true` for flags such as `httponly`). */
  attributes: Record<string, string | true>;
}

/** Parses the `Set-Cookie` header for `name`, or `undefined` if the response doesn't set it. */
export function setCookieOf(res: Response, name: string): SetCookie | undefined {
  const header = res.headers['set-cookie'] as unknown;
  const lines = Array.isArray(header) ? (header as string[]) : [];
  const line = lines.findLast((candidate) => candidate.startsWith(`${name}=`));
  if (line === undefined) return undefined;
  const [pair = '', ...parts] = line.split(';').map((part) => part.trim());
  const attributes: Record<string, string | true> = {};
  for (const part of parts) {
    const [key = '', ...rest] = part.split('=');
    attributes[key.toLowerCase()] = rest.length === 0 ? true : rest.join('=');
  }
  return { value: decodeURIComponent(pair.slice(name.length + 1)), attributes };
}

/** Requests as the user of a test session: its cookies on every request, its CSRF token on writes. */
export interface SessionClient {
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body: object) => request.Test;
  delete: (path: string) => request.Test;
}

export function sessionClient(app: NestFastifyApplication, session: TestSession): SessionClient {
  const server = app.getHttpServer();
  const write = (test: request.Test, body?: object) => {
    const sent = test.set('Cookie', session.cookie).set(CSRF_HEADER, session.csrfToken);
    return body === undefined ? sent : sent.send(body);
  };
  return {
    get: (path) => request(server).get(path).set('Cookie', session.cookie),
    post: (path, body) => write(request(server).post(path), body),
    patch: (path, body) => write(request(server).patch(path), body),
    delete: (path) => write(request(server).delete(path)),
  };
}
