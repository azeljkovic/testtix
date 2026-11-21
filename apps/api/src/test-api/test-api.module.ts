import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { TestClockController } from './test-clock.controller.js';
import { TestKeyGuard } from './test-key.guard.js';

/**
 * The test API (`/__test/*`). `AppModule` imports it only when `TESTTIX_TEST_MODE=true`;
 * otherwise its routes don't exist and answer 404 like any unknown path.
 */
@Module({
  controllers: [TestClockController],
  providers: [TestKeyGuard],
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
