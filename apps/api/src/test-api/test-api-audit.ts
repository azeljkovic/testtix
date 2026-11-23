import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { TEST_KEY_HEADER } from './test-key.guard.js';

const TEST_API_PREFIX = '/__test/';

/** What the audit line of one test API call records. */
export interface TestApiAuditEntry {
  method: string;
  path: string;
  status: number;
  /** The client address (behind `TRUST_PROXY` proxies), the same one rate limits count. */
  ip: string;
  /** Whether the request carried an `X-Test-Key` header (never its value). */
  testKeySent: boolean;
  requestId: string;
  durationMs: number;
}

/**
 * Writes one audit log line (logger context `TestApiAudit`, message "Test API call") for every
 * request to `/__test/*`, whatever its outcome: rejected calls (401 wrong test key, 429 rate
 * limited, 404 unknown scenario) are logged too. A Fastify hook, since Nest interceptors don't see
 * requests their guards rejected.
 */
@Injectable()
export class TestApiAudit implements OnModuleInit {
  private readonly logger = new Logger('TestApiAudit');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    fastify.addHook('onResponse', (request, reply, done) => {
      if (request.url.startsWith(TEST_API_PREFIX)) {
        const entry: TestApiAuditEntry = {
          method: request.method,
          path: request.url.split('?', 1)[0] ?? request.url,
          status: reply.statusCode,
          ip: request.ip,
          testKeySent: request.headers[TEST_KEY_HEADER] !== undefined,
          requestId: request.id,
          durationMs: Math.round(reply.elapsedTime),
        };
        this.logger.log({ msg: 'Test API call', testApi: entry });
      }
      done();
    });
  }
}
