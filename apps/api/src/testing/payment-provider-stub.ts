import { once } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import type { PaymentSession } from '@testtix/shared';

export interface StubRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/**
 * How the stub answers `POST /sessions`: `ok` (a valid session), `error` (HTTP 503), `garbage`
 * (200 with a body that isn't a session) or `hang` (no answer until the stub closes).
 */
export type StubBehaviour = 'ok' | 'error' | 'garbage' | 'hang';

/**
 * A stand-in for the fake payment provider's `POST /sessions`, for API tests: it records every
 * request and answers as `behaviour` says. Start it, point `PAYMENTS_BASE_URL` at `url`, and close
 * it when the test file is done.
 */
export interface PaymentProviderStub {
  url: string;
  requests: StubRequest[];
  behaviour: StubBehaviour;
  close: () => Promise<void>;
}

export async function startPaymentProviderStub(): Promise<PaymentProviderStub> {
  const hanging = new Set<ServerResponse>();
  let sessions = 0;
  const stub: PaymentProviderStub = {
    url: '',
    requests: [],
    behaviour: 'ok',
    close: async () => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body: unknown = text === '' ? undefined : JSON.parse(text);
      stub.requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body,
      });
      if (req.method !== 'POST' || req.url !== '/sessions') {
        res.writeHead(404).end();
        return;
      }
      switch (stub.behaviour) {
        case 'error':
          res.writeHead(503, { 'content-type': 'application/json' }).end('{"title":"down"}');
          return;
        case 'garbage':
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":42}');
          return;
        case 'hang':
          hanging.add(res);
          return;
        case 'ok': {
          sessions += 1;
          const session = sessionFor(
            body as SessionRequest,
            `ps_test_${String(sessions)}`,
            stub.url,
          );
          res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(session));
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  stub.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return stub;
}

interface SessionRequest {
  amountCents: number;
  description: string;
  returnUrl: string;
  webhookUrl: string;
  metadata?: Record<string, string>;
}

function sessionFor(request: SessionRequest, id: string, baseUrl: string): PaymentSession {
  const createdAt = new Date();
  return {
    id,
    status: 'OPEN',
    amountCents: request.amountCents,
    currency: 'USD',
    description: request.description,
    url: `${baseUrl}/pay/${id}`,
    returnUrl: request.returnUrl,
    webhookUrl: request.webhookUrl,
    metadata: request.metadata ?? {},
    failureCode: null,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 30 * 60_000).toISOString(),
    completedAt: null,
    webhookDeliveries: [],
  };
}
