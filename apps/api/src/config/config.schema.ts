import { DEV_PAYMENTS_API_KEY, DEV_PAYMENTS_WEBHOOK_SECRET } from '@testtix/shared';
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
/** The fake payment provider from `docker/compose.yml` (`FAKE_PAYMENTS_PORT`). */
export const DEV_PAYMENTS_BASE_URL = 'http://localhost:4000';
/**
 * Where the provider (in its compose container) reaches the API that `pnpm dev` runs on the host.
 * `{port}` is replaced with `PORT`.
 */
export const DEV_PAYMENTS_WEBHOOK_URL = 'http://host.docker.internal:{port}/webhooks/payments';

const httpUrl = z.url({ protocol: /^https?$/, error: 'Must be an http:// or https:// URL' });

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
    // The payment provider's API (`POST /sessions`).
    PAYMENTS_BASE_URL: httpUrl.optional(),
    // Bearer key for the provider's API. Same value as the fake provider's `PAYMENTS_API_KEY`.
    PAYMENTS_API_KEY: z.string().min(16, 'Must be at least 16 characters').optional(),
    // Where the provider sends payment webhooks: this API's `/webhooks/payments`, as the provider
    // reaches it.
    PAYMENTS_WEBHOOK_URL: httpUrl.optional(),
    // A provider request that takes longer fails, and checkout answers 503.
    PAYMENTS_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
    // HMAC key of the provider's webhook signatures. Same value as the fake provider's.
    PAYMENTS_WEBHOOK_SECRET: z.string().min(16, 'Must be at least 16 characters').optional(),
    // Webhooks whose signed timestamp is further than this from the real time are rejected
    // (replay protection). Checked against the real time, never the test clock.
    PAYMENTS_WEBHOOK_TOLERANCE_SEC: z.coerce.number().int().min(1).max(3600).default(300),
    // How long the order processing job waits before confirming or failing a `PROCESSING` order,
    // so clients see "processing" for a while ("data appears eventually").
    JOB_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(1000),
    // `retryAfterMs` of an order that is still changing: how long clients wait between polls.
    ORDER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2000),
  })
  .superRefine((env, ctx) => {
    // Dev defaults carry well-known credentials or point at localhost, so production must set
    // connection URLs, the public web URL and the payment provider explicitly.
    if (env.NODE_ENV !== 'production') return;
    const required = [
      'DATABASE_URL',
      'REDIS_URL',
      'SMTP_URL',
      'WEB_BASE_URL',
      'PAYMENTS_BASE_URL',
      'PAYMENTS_API_KEY',
      'PAYMENTS_WEBHOOK_URL',
      'PAYMENTS_WEBHOOK_SECRET',
    ] as const;
    for (const key of required) {
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
    payments: {
      baseUrl: (env.PAYMENTS_BASE_URL ?? DEV_PAYMENTS_BASE_URL).replace(/\/+$/, ''),
      apiKey: env.PAYMENTS_API_KEY ?? DEV_PAYMENTS_API_KEY,
      webhookUrl:
        env.PAYMENTS_WEBHOOK_URL ?? DEV_PAYMENTS_WEBHOOK_URL.replace('{port}', String(env.PORT)),
      timeoutMs: env.PAYMENTS_TIMEOUT_MS,
      webhookSecret: env.PAYMENTS_WEBHOOK_SECRET ?? DEV_PAYMENTS_WEBHOOK_SECRET,
      webhookToleranceMs: env.PAYMENTS_WEBHOOK_TOLERANCE_SEC * 1000,
    },
    orderPollIntervalMs: env.ORDER_POLL_INTERVAL_MS,
    orderProcessingDelayMs: env.JOB_PROCESSING_DELAY_MS,
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
