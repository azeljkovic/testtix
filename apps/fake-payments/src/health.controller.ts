import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Liveness for Docker and the smoke test. The service has no dependencies to check. */
  @Get()
  live() {
    return { status: 'ok' as const };
  }
}
