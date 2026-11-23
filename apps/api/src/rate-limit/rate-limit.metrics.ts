import { Inject, Injectable } from '@nestjs/common';
import { Counter, type Registry } from '@prometheus-io/client';

import { METRICS_REGISTRY } from '../metrics/metrics.module.js';
import type { RateLimitGroup } from './rate-limit-groups.js';

/** Rate-limit metrics on `/metrics`, per API process (Prometheus sums replicas). */
@Injectable()
export class RateLimitMetrics {
  private readonly counter: Counter<'group'>;

  constructor(@Inject(METRICS_REGISTRY) registry: Registry) {
    this.counter = new Counter({
      name: 'testtix_rate_limited_requests_total',
      help: 'Requests answered 429 because a rate-limit group was exhausted',
      labelNames: ['group'],
      registers: [registry],
    });
  }

  rejected(group: RateLimitGroup): void {
    this.counter.inc({ group });
  }
}
