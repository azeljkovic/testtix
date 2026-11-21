import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES, type ProblemDetails } from '@testtix/shared';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../testing/msw-server.js';
import { api } from './client.js';
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
