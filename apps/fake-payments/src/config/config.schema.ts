import { DEV_PAYMENTS_API_KEY, DEV_PAYMENTS_WEBHOOK_SECRET } from '@testtix/shared';
import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * Local-only defaults, shared with the API (`packages/shared`), so the two services work together
 * without a `.env`. Production must set its own (see `superRefine` below).
 */
export const DEV_API_KEY = DEV_PAYMENTS_API_KEY;
export const DEV_WEBHOOK_SECRET = DEV_PAYMENTS_WEBHOOK_SECRET;

/**
 * Environment variables read by the fake payment provider. Keep in sync with `.env.example` and
 * the `fake-payments` service in `docker/compose.yml`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // Where browsers reach this service. Payment page URLs start with it.
    PUBLIC_BASE_URL: z
      .url({ protocol: /^https?$/, error: 'Must be an http:// or https:// URL' })
      .optional(),
    // Bearer token the API sends with `POST /sessions` and `GET /sessions/:id`.
    PAYMENTS_API_KEY: z.string().min(16, 'Must be at least 16 characters').optional(),
    // HMAC key of the webhook signature. The API verifies with the same value.
    PAYMENTS_WEBHOOK_SECRET: z.string().min(16, 'Must be at least 16 characters').optional(),
    // How long a payment page stays payable.
    SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    // Wait before the "delayed webhook" test card's event is delivered.
    DELAYED_WEBHOOK_MS: z.coerce.number().int().min(0).max(600_000).default(10_000),
    // Deliveries per event, the first one included, before the provider gives up.
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
    // Wait before the first retry; each later retry waits twice as long (capped at 5 minutes).
    WEBHOOK_RETRY_BASE_MS: z.coerce.number().int().min(1).max(300_000).default(1000),
    // A delivery that gets no response in this time counts as failed and is retried.
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['PUBLIC_BASE_URL', 'PAYMENTS_API_KEY', 'PAYMENTS_WEBHOOK_SECRET'] as const) {
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
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ''),
    apiKey: env.PAYMENTS_API_KEY ?? DEV_API_KEY,
    webhookSecret: env.PAYMENTS_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET,
    sessionTtlMs: env.SESSION_TTL_MINUTES * 60 * 1000,
    delayedWebhookMs: env.DELAYED_WEBHOOK_MS,
    webhook: {
      maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
      retryBaseMs: env.WEBHOOK_RETRY_BASE_MS,
      timeoutMs: env.WEBHOOK_TIMEOUT_MS,
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

/** Validates the environment, listing every invalid variable at once. Empty values count as unset. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return Object.freeze(result.data);
}
