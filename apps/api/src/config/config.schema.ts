import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Defaults match `docker/compose.yml`, so `pnpm infra:up && pnpm dev` works without a `.env`. */
export const DEV_DATABASE_URL = 'postgresql://testtix:testtix@localhost:5432/testtix';
export const DEV_REDIS_URL = 'redis://localhost:6379';
/** Mailpit's SMTP port from `docker/compose.yml`. */
export const DEV_SMTP_URL = 'smtp://localhost:1025';
/** The web dev server (`WEB_PORT` in `.env.example`). */
export const DEV_WEB_BASE_URL = 'http://localhost:5173';
export const DEFAULT_MAIL_FROM = 'TestTix <no-reply@testtix.test>';

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
    // Where outgoing email goes: smtp://[user:password@]host:port, or smtps:// for implicit TLS.
    SMTP_URL: z
      .url({ protocol: /^smtps?$/, error: 'Must be an smtp:// or smtps:// URL' })
      .optional(),
    // `From` header of every email: an address, optionally with a display name.
    MAIL_FROM: z.string().min(3).max(200).default(DEFAULT_MAIL_FROM),
    // Public URL of the web app. Links in emails (verification, tickets) point here.
    WEB_BASE_URL: z
      .url({ protocol: /^https?$/, error: 'Must be an http:// or https:// URL' })
      .optional(),
    // How long an email verification link works.
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    // The API process also runs the background job worker. Set false when the worker runs as its
    // own process (`node dist/worker.js`), e.g. to scale it separately.
    WORKER_IN_PROCESS: z
      .stringbool({ truthy: ['true'], falsy: ['false'], error: 'Must be true or false' })
      .default(true),
    // Repeatable job that deletes expired holds and frees their tickets. Cleanup only: expired
    // holds count as available whether or not it runs.
    HOLD_SWEEPER_ENABLED: z
      .stringbool({ truthy: ['true'], falsy: ['false'], error: 'Must be true or false' })
      .default(true),
    HOLD_SWEEPER_INTERVAL_MS: z.coerce.number().int().min(100).max(86_400_000).default(60_000),
  })
  .superRefine((env, ctx) => {
    // Dev defaults carry well-known credentials or point at localhost, so production must set
    // connection URLs and the public web URL explicitly.
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'SMTP_URL', 'WEB_BASE_URL'] as const) {
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
    smtpUrl: env.SMTP_URL ?? DEV_SMTP_URL,
    mailFrom: env.MAIL_FROM,
    webBaseUrl: (env.WEB_BASE_URL ?? DEV_WEB_BASE_URL).replace(/\/+$/, ''),
    emailVerificationTtlMs: env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    workerInProcess: env.WORKER_IN_PROCESS,
    holdSweeper: {
      enabled: env.HOLD_SWEEPER_ENABLED,
      intervalMs: env.HOLD_SWEEPER_INTERVAL_MS,
    },
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
