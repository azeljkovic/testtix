import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { AppConfig } from './config.schema.js';

/** Injection token for the validated, frozen `AppConfig`. Use `@Inject(APP_CONFIG)`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Makes the config parsed in `main.ts` (or by a test) injectable everywhere.
 * Config is parsed before Nest boots, so a bad environment never gets as far as creating modules.
 */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
