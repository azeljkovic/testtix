import type { AppConfig } from '../config/config.schema.js';

/** Metadata key of `@RateLimit()`: the groups a route or controller was added to. */
export const RATE_LIMIT_GROUPS_KEY = 'testtix:rate-limit:groups';

/** Prefix of every rate-limit counter in Redis. `POST /__test/reset` deletes them all. */
export const RATE_LIMIT_KEY_PREFIX = 'testtix:ratelimit';

/**
 * Who a group's counter belongs to: the client address (counted before authentication, so it
 * also limits requests that fail it), or the logged-in user (only on routes that need a session).
 */
export type RateLimitScope = 'client' | 'user';

interface RateLimitGroupDefinition {
  scope: RateLimitScope;
  /** What the group covers, for the 429 `detail`. */
  covers: string;
  /** Routes in this group don't count towards the `default` group. */
  replacesDefault: boolean;
}

/**
 * Route groups that share a limit (`RATE_LIMIT_*` env vars). Every route counts towards
 * `default` unless it is `@NoRateLimit()` or in a group that replaces it; `@RateLimit(group)`
 * adds a route to another group as well.
 */
export const RATE_LIMIT_GROUPS = {
  default: { scope: 'client', covers: 'the API', replacesDefault: false },
  auth: {
    scope: 'client',
    covers: 'logging in, registering and verifying email addresses',
    replacesDefault: false,
  },
  testApi: { scope: 'client', covers: 'the test API', replacesDefault: true },
  verificationResend: {
    scope: 'user',
    covers: 'sending verification emails to this account',
    replacesDefault: false,
  },
} as const satisfies Record<keyof AppConfig['rateLimit']['groups'], RateLimitGroupDefinition>;

export type RateLimitGroup = keyof typeof RATE_LIMIT_GROUPS;

export const RATE_LIMIT_GROUP_NAMES = Object.keys(RATE_LIMIT_GROUPS) as readonly RateLimitGroup[];

export function isRateLimitGroup(name: string): name is RateLimitGroup {
  return Object.hasOwn(RATE_LIMIT_GROUPS, name);
}

/** The groups a route counts towards, given the groups it was added to. */
export function effectiveGroups(
  routeGroups: readonly RateLimitGroup[],
  noDefault: boolean,
): RateLimitGroup[] {
  const groups = [...new Set(routeGroups)].filter((group) => group !== 'default');
  const replaced = noDefault || groups.some((group) => RATE_LIMIT_GROUPS[group].replacesDefault);
  return replaced ? groups : ['default', ...groups];
}

const UNITS = [
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
] as const;

/** `60_000` → "minute", `900_000` → "15 minutes", `90_000` → "90 seconds". */
export function describeWindow(windowMs: number): string {
  const [unit, size] = UNITS.find(([, ms]) => windowMs % ms === 0) ?? ['second', 1000];
  const count = Math.max(1, Math.round(windowMs / size));
  return count === 1 ? unit : `${String(count)} ${unit}s`;
}
