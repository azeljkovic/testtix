import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * Structured JSON logs (pino), like the API's. Request bodies are never logged, so card details
 * typed on the payment page stay out of the logs.
 */
@Module({})
export class LoggingModule {
  static forRoot(): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            pinoHttp: {
              level: config.logLevel,
              base: { service: 'fake-payments' },
              timestamp: stdTimeFunctions.isoTime,
              customLogLevel: (_req, res, err) => {
                if (err !== undefined || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                return 'info';
              },
              redact: { paths: ['req.headers.authorization'], censor: '[redacted]' },
            },
          }),
        }),
      ],
    };
  }
}
