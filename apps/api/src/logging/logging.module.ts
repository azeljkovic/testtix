import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/** Which process writes the logs: the `service` field of every line. */
export type LogService = 'api' | 'worker';

/** Structured JSON logs (pino). Every request gets an ID that appears in its log lines as `req.id`. */
@Module({})
export class LoggingModule {
  static forRoot(service: LogService): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            pinoHttp: {
              level: config.logLevel,
              base: { service },
              timestamp: stdTimeFunctions.isoTime,
              // No genReqId: Fastify assigns `req.id` (see `createHttpAdapter`) and pino-http keeps it.
              customLogLevel: (_req, res, err) => {
                if (err !== undefined || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                return 'info';
              },
              redact: {
                paths: [
                  'req.headers.authorization',
                  'req.headers.cookie',
                  'req.headers["x-test-key"]',
                  'req.headers["x-load-test-key"]',
                  'res.headers["set-cookie"]',
                ],
                censor: '[redacted]',
              },
            },
          }),
        }),
      ],
    };
  }
}
