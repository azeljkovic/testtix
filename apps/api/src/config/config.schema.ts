import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Defaults match `docker/compose.yml`, so `pnpm infra:up && pnpm dev` works without a `.env`. */
export const DEV_DATABASE_URL = 'postgresql://testtix:testtix@localhost:5432/testtix';
export const DEV_REDIS_URL = 'redis://localhost:6379';

/**
 * Environment variables read by the API.
 * Keep in sync with `.env.example` (definition of done, item 4).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: z
      .url({ protocol: /^postgres(ql)?$/, error: 'Must be a postgres:// or postgresql:// URL' })
      .optional(),
    REDIS_URL: z
      .url({ protocol: /^rediss?$/, error: 'Must be a redis:// or rediss:// URL' })
      .optional(),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(1000),
    // Enables the test API (`/__test/*`) and the controllable clock. Never on for a real shop.
    TESTTIX_TEST_MODE: z
      .stringbool({ truthy: ['true'], falsy: ['false'], error: 'Must be true or false' })
      .default(false),
    // When set, global-effect test endpoints (clock, reset) require it in an `X-Test-Key` header.
    TEST_API_KEY: z.string().min(16, 'Must be at least 16 characters').optional(),
    // Idle timeout of a login session: each authenticated request moves its expiry this far ahead.
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
    // `Secure` attribute of the session and CSRF cookies. Defaults to on in production only, since
    // browsers drop Secure cookies on plain-HTTP origins such as http://localhost.
    COOKIE_SECURE: z
      .stringbool({ truthy: ['true'], falsy: ['false'], error: 'Must be true or false' })
      .optional(),
  })
  .superRefine((env, ctx) => {
    // Dev defaults carry well-known credentials, so production must set connection URLs explicitly.
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'REDIS_URL'] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when NODE_ENV is production',
        });
      }
    }
  })
  .transform((env) => ({
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL ?? DEV_DATABASE_URL,
    redisUrl: env.REDIS_URL ?? DEV_REDIS_URL,
    healthCheckTimeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
    testMode: env.TESTTIX_TEST_MODE,
    testApiKey: env.TEST_API_KEY,
    sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type AppConfig = Readonly<z.output<typeof envSchema>>;

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Parses and validates environment variables. Throws `ConfigValidationError` listing every
 * invalid variable at once, so the API fails fast on startup instead of on first use. The
 * production-only rule runs after the per-variable checks pass (Zod skips refinements otherwise).
 * Empty values (`PORT=`) count as unset, so a blank line in `.env` falls back to the default.
 */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return Object.freeze(result.data);
}
