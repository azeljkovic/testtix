import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { AppConfig } from './config.schema.js';

/** Injection token for the validated, frozen `AppConfig`. Use `@Inject(APP_CONFIG)`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Makes the config parsed in `main.ts` (or by a test) injectable everywhere. */
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
