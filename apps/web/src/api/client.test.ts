import {
  CSRF_COOKIE,
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPES,
  type ProblemDetails,
} from '@testtix/shared';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import { api, csrfHeader, readCookie } from './client.js';
import { ApiError, unwrap } from './errors.js';

const problem: ProblemDetails = {
  type: PROBLEM_TYPES.VALIDATION_ERROR,
  title: 'Validation failed',
  status: 400,
  detail: 'The request is invalid. See `errors` for each problem.',
  instance: '/health',
  requestId: 'req-1',
  errors: [{ path: 'name', code: 'too_small', message: 'Too small' }],
};

function problemResponse(body: ProblemDetails) {
  return HttpResponse.json(body, {
    status: body.status,
    headers: { 'Content-Type': PROBLEM_CONTENT_TYPE },
  });
}

async function apiErrorFrom(promise: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await promise.catch((err: unknown) => err);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('api client', () => {
  it('calls the API under /api on the page origin', async () => {
    let requested: string | undefined;
    server.use(
      http.get('/api/health', ({ request }) => {
        requested = request.url;
        return HttpResponse.json({ status: 'ok' });
      }),
    );

    expect(unwrap(await api.GET('/health'))).toEqual({ status: 'ok' });
    expect(requested).toBe(`${window.location.origin}/api/health`);
  });

  it('turns a problem details response into an ApiError with its code', async () => {
    server.use(http.get('/api/health', () => problemResponse(problem)));

    const error = await apiErrorFrom(api.GET('/health').then(unwrap));
    expect(error.status).toBe(400);
    expect(error.problem).toEqual(problem);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe(problem.detail);
  });

  it('leaves the code undefined for a problem without one', async () => {
    server.use(
      http.get('/api/health', () =>
        problemResponse({ ...problem, type: 'about:blank', title: 'Not Found', status: 404 }),
      ),
    );

    const error = await apiErrorFrom(api.GET('/health').then(unwrap));
    expect(error.status).toBe(404);
    expect(error.problem?.title).toBe('Not Found');
    expect(error.code).toBeUndefined();
  });

  it('still reports the status when the error body is not problem details', async () => {
    server.use(
      http.get(
        '/api/health',
        () => new HttpResponse('<h1>Bad Gateway</h1>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );

    const error = await apiErrorFrom(api.GET('/health').then(unwrap));
    expect(error.status).toBe(502);
    expect(error.problem).toBeUndefined();
    expect(error.message).toBe('The API returned 502 Bad Gateway');
  });
});

describe('csrfHeader', () => {
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`;
  });

  it('uses the token in the CSRF cookie without calling the API', async () => {
    document.cookie = `${CSRF_COOKIE}=from-cookie; Path=/`;
    server.use(http.get('/api/auth/csrf', () => HttpResponse.error()));

    expect(await csrfHeader()).toEqual({ 'X-CSRF-Token': 'from-cookie' });
  });

  it('asks GET /auth/csrf for a token when there is no cookie', async () => {
    expect(await csrfHeader()).toEqual({ 'X-CSRF-Token': MOCK_CSRF_TOKEN });
  });

  it('fails when the API hands out no token', async () => {
    server.use(http.get('/api/auth/csrf', () => new HttpResponse(null, { status: 503 })));

    await expect(csrfHeader()).rejects.toThrow('Could not get a CSRF token: 503');
  });
});

describe('readCookie', () => {
  afterEach(() => {
    document.cookie = 'a=; Max-Age=0; Path=/';
    document.cookie = 'b=; Max-Age=0; Path=/';
  });

  it('finds a cookie by name and decodes its value', () => {
    document.cookie = 'a=1; Path=/';
    document.cookie = `b=${encodeURIComponent('x=y z')}; Path=/`;

    expect(readCookie('b')).toBe('x=y z');
    expect(readCookie('a')).toBe('1');
    expect(readCookie('missing')).toBeUndefined();
  });
});
