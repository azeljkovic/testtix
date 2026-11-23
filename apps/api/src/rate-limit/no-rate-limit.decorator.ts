import { applyDecorators } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * OpenAPI extensions the rate-limit decorators leave on operations, so `addRateLimitDocs`
 * documents the limits each route has. `addRateLimitDocs` removes them from the published spec.
 */
export const RATE_LIMIT_GROUPS_EXTENSION = 'x-testtix-rate-limit-groups';
export const NO_RATE_LIMIT_EXTENSION = 'x-testtix-no-rate-limit';

/**
 * Takes a route (or controller) out of the `default` rate-limit group, e.g. health checks and
 * webhooks. (Its own file, with no guard imports, so `MetricsModule` can use it without a cycle.)
 */
export function NoRateLimit(): MethodDecorator & ClassDecorator {
  return applyDecorators(SkipThrottle(), ApiExtension(NO_RATE_LIMIT_EXTENSION, true));
}
