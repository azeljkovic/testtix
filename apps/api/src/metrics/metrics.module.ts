import { Controller, Get, Header, Inject, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { collectDefaultMetrics, Registry } from '@prometheus-io/client';

import { Public } from '../auth/auth.decorators.js';
import { NoRateLimit } from '../rate-limit/no-rate-limit.decorator.js';
import { HttpMetrics } from './http-metrics.js';
import { METRICS_REGISTRY } from './metrics.tokens.js';

export { METRICS_REGISTRY } from './metrics.tokens.js';

const PROMETHEUS_CONTENT_TYPE = Registry.PROMETHEUS_CONTENT_TYPE;

@ApiTags('metrics')
@Controller('metrics')
@Public()
@NoRateLimit()
export class MetricsController {
  constructor(@Inject(METRICS_REGISTRY) private readonly registry: Registry) {}

  @Get()
  @ApiOperation({
    summary: 'Prometheus metrics',
    description:
      'Node.js process metrics, HTTP requests, holds, orders, waiting rooms, rate limits and, where the worker runs in this process, background jobs (`testtix_*`; see the testing guide).',
  })
  @ApiProduces(PROMETHEUS_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Prometheus text exposition format.', schema: { type: 'string' } })
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  @Header('Cache-Control', 'no-store')
  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

/**
 * `GET /metrics` and the registry other modules add their metrics to. Imported by the API and the
 * standalone worker, which serves it on `WORKER_PORT` next to its health checks.
 */
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: METRICS_REGISTRY,
      useFactory: () => {
        const registry = new Registry();
        collectDefaultMetrics({ register: registry });
        return registry;
      },
    },
    HttpMetrics,
  ],
  exports: [METRICS_REGISTRY],
})
export class MetricsModule {}
