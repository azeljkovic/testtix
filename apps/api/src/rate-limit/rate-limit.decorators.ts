import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

import {
  RATE_LIMIT_GROUPS,
  RATE_LIMIT_GROUPS_KEY,
  type RateLimitGroup,
} from './rate-limit-groups.js';
import { UserRateLimitGuard } from './rate-limit.guard.js';
import { RATE_LIMIT_GROUPS_EXTENSION } from './no-rate-limit.decorator.js';

/**
 * Adds a route (or every route of a controller) to rate-limit groups, on top of `default` unless a
 * group replaces it. Per-user groups also apply `UserRateLimitGuard`, which runs after `AuthGuard`,
 * so only use them on routes that need a session.
 */
export function RateLimit(...groups: [RateLimitGroup, ...RateLimitGroup[]]) {
  const perUser = groups.some((group) => RATE_LIMIT_GROUPS[group].scope === 'user');
  return applyDecorators(
    SetMetadata(RATE_LIMIT_GROUPS_KEY, groups),
    ApiExtension(RATE_LIMIT_GROUPS_EXTENSION, groups),
    ...(perUser ? [UseGuards(UserRateLimitGuard)] : []),
  );
}
