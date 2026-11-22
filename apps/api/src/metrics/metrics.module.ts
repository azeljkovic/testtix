import { Controller, Get, Header, Inject, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { collectDefaultMetrics, Registry } from '@prometheus-io/client';

import { Public } from '../auth/auth.decorators.js';

/** The API's own registry (not the library's global one), so each app instance starts clean. */
export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY');

const PROMETHEUS_CONTENT_TYPE = Registry.PROMETHEUS_CONTENT_TYPE;

@ApiTags('metrics')
@Controller('metrics')
@Public()
export class MetricsController {
  constructor(@Inject(METRICS_REGISTRY) private readonly registry: Registry) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics', description: 'Default Node.js process metrics.' })
  @ApiProduces(PROMETHEUS_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Prometheus text exposition format.', schema: { type: 'string' } })
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  @Header('Cache-Control', 'no-store')
  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

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
  ],
  exports: [METRICS_REGISTRY],
})
export class MetricsModule {}
