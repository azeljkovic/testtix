import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Counter, Histogram, type Registry } from '@prometheus-io/client';
import type { FastifyInstance } from 'fastify';

import { METRICS_REGISTRY } from './metrics.tokens.js';

/** Label of requests no route matched (404s for unknown paths), so paths never become labels. */
export const UNMATCHED_ROUTE = '(unmatched)';

/** Seconds; from a fast cached read to a slow checkout under load. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Request metrics on `/metrics` (C6.2) for every response the process sends, those rejected by a
 * guard or a malformed body included. `route` is the route's pattern (`/events/:eventId/holds`),
 * never the requested path, so the label set stays small.
 */
@Injectable()
export class HttpMetrics implements OnModuleInit {
  private readonly requests: Counter<'method' | 'route' | 'status'>;
  private readonly duration: Histogram<'method' | 'route'>;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    this.requests = new Counter({
      name: 'testtix_http_requests_total',
      help: 'HTTP responses by method, route pattern and status code',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'testtix_http_request_duration_seconds',
      help: 'Time from receiving an HTTP request to sending its response',
      labelNames: ['method', 'route'],
      buckets: DURATION_BUCKETS,
      registers: [registry],
    });
  }

  onModuleInit(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    fastify.addHook('onResponse', (request, reply, done) => {
      const method = request.method;
      // Fastify leaves `url` undefined when no route matched.
      const route = request.routeOptions.url ?? UNMATCHED_ROUTE;
      this.requests.inc({ method, route, status: String(reply.statusCode) });
      this.duration.observe({ method, route }, reply.elapsedTime / 1000);
      done();
    });
  }
}
