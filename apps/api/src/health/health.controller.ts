import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse } from 'nestjs-zod';

import { LivenessDto, ReadinessDto, ReadinessSchema } from './health.schemas.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness',
    description: 'Returns 200 while the process can serve requests. Does not check dependencies.',
  })
  @ZodResponse({ status: 200, type: LivenessDto, description: 'The API process is up.' })
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness',
    description:
      'Checks that Postgres and Redis respond. Returns 503 with the same body shape when any check is down.',
  })
  @ApiOkResponse({ type: ReadinessDto.Output, description: 'Every dependency is up.' })
  @ApiServiceUnavailableResponse({
    type: ReadinessDto.Output,
    description: 'At least one dependency is down.',
  })
  async ready(@Res() res: FastifyReply): Promise<void> {
    // Sent manually: Nest would otherwise override a 503 set on a passthrough response with 200.
    const report = ReadinessSchema.parse(await this.health.readiness());
    await res
      .status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .send(report);
  }
}
