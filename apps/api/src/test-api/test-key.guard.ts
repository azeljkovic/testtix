import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE } from '@testtix/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { safeEqual } from '../infra/safe-equal.js';

export const TEST_KEY_HEADER = 'x-test-key';

/**
 * Protects test endpoints with a global effect (clock, reset) on shared instances such as the
 * hosted demo. When `TEST_API_KEY` is unset (local development) every request passes.
 */
@Injectable()
export class TestKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.testApiKey;
    if (expected === undefined) return true;

    const http = context.switchToHttp();
    const provided = http.getRequest<FastifyRequest>().headers[TEST_KEY_HEADER];
    if (typeof provided === 'string' && safeEqual(provided, expected)) return true;

    // RFC 9110 requires a challenge on every 401; the filter keeps headers already set.
    void http.getResponse<FastifyReply>().header('WWW-Authenticate', 'TestKey realm="test-api"');
    throw new UnauthorizedException('Missing or invalid X-Test-Key header.');
  }
}

/** Applies `TestKeyGuard` and documents the header and the 401 response. */
export function RequiresTestKey(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseGuards(TestKeyGuard),
    ApiHeader({
      name: 'X-Test-Key',
      required: false,
      description: 'Required when the server sets `TEST_API_KEY` (e.g. the hosted demo).',
    }),
    ApiResponse({
      status: 401,
      description: 'The server requires an `X-Test-Key` header and it is missing or wrong.',
      content: {
        [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    }),
  );
}
