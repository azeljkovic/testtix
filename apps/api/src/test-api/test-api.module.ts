import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { WaitingRoomModule } from '../waiting-room/waiting-room.module.js';
import { TestScenariosController } from './scenarios/test-scenarios.controller.js';
import { TestScenariosService } from './scenarios/test-scenarios.service.js';
import { TestSessionsController } from './sessions/test-sessions.controller.js';
import { TestSessionsService } from './sessions/test-sessions.service.js';
import { TestApiAudit } from './test-api-audit.js';
import { TestClockController } from './test-clock.controller.js';
import { TestKeyGuard } from './test-key.guard.js';
import { TestResetController } from './test-reset.controller.js';
import { TestResetService } from './test-reset.service.js';

/**
 * The test API (`/__test/*`). `AppModule` imports it only when `TESTTIX_TEST_MODE=true`;
 * otherwise its routes don't exist and answer 404 like any unknown path.
 * Its routes share the `testApi` rate limit (`@TestApiController()`), and every call gets an
 * audit log line (`TestApiAudit`).
 */
@Module({
  imports: [AuthModule, WaitingRoomModule],
  controllers: [
    TestClockController,
    TestResetController,
    TestScenariosController,
    TestSessionsController,
  ],
  providers: [
    TestApiAudit,
    TestKeyGuard,
    TestResetService,
    TestScenariosService,
    TestSessionsService,
  ],
})
export class TestApiModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('TestMode');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onApplicationBootstrap(): void {
    this.logger.warn(
      this.config.testApiKey === undefined
        ? 'Test mode is on: /__test/* is enabled and open to everyone (TEST_API_KEY is not set)'
        : 'Test mode is on: /__test/* is enabled; clock and reset require X-Test-Key',
    );
  }
}
