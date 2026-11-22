import { http, HttpResponse } from 'msw';

import { csrfHeaderOf } from './auth.js';
import { server } from './msw-server.js';

export interface RecordedRequest {
  url: URL;
  body: unknown;
  csrf: string | null;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * Answers `method path` with `respond(request)` and records each request (URL, JSON body, CSRF
 * header), in order. A `Response` is sent as it is; anything else as JSON (`undefined`: 204).
 */
export function mockAdminRequest(
  method: Method,
  path: string,
  respond: (request: RecordedRequest) => unknown = () => undefined,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  server.use(
    http[method](path, async ({ request }) => {
      const text = await request.text();
      const recorded: RecordedRequest = {
        url: new URL(request.url),
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
        csrf: csrfHeaderOf(request),
      };
      requests.push(recorded);
      const result = respond(recorded);
      if (result instanceof Response) return result;
      if (result === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(result, { status: method === 'post' ? 201 : 200 });
    }),
  );
  return requests;
}
