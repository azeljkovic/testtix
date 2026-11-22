import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  DEV_API_KEY,
  DEV_WEBHOOK_SECRET,
  parseConfig,
} from './config.schema.js';

describe('parseConfig', () => {
  it('has working local defaults', () => {
    expect(parseConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'info',
      publicBaseUrl: 'http://localhost:4000',
      apiKey: DEV_API_KEY,
      webhookSecret: DEV_WEBHOOK_SECRET,
      sessionTtlMs: 30 * 60 * 1000,
      delayedWebhookMs: 10_000,
      webhook: { maxAttempts: 6, retryBaseMs: 1000, timeoutMs: 5000 },
    });
  });

  it('reads every variable and strips a trailing slash from the public URL', () => {
    const config = parseConfig({
      PORT: '4100',
      PUBLIC_BASE_URL: 'https://pay.example.test/',
      PAYMENTS_API_KEY: 'sk_live_0123456789abcdef',
      PAYMENTS_WEBHOOK_SECRET: 'whsec_0123456789abcdef',
      SESSION_TTL_MINUTES: '5',
      DELAYED_WEBHOOK_MS: '2500',
      WEBHOOK_MAX_ATTEMPTS: '3',
      WEBHOOK_RETRY_BASE_MS: '50',
      WEBHOOK_TIMEOUT_MS: '700',
    });
    expect(config).toMatchObject({
      port: 4100,
      publicBaseUrl: 'https://pay.example.test',
      apiKey: 'sk_live_0123456789abcdef',
      webhookSecret: 'whsec_0123456789abcdef',
      sessionTtlMs: 5 * 60 * 1000,
      delayedWebhookMs: 2500,
      webhook: { maxAttempts: 3, retryBaseMs: 50, timeoutMs: 700 },
    });
  });

  it('defaults the public URL to the configured port', () => {
    expect(parseConfig({ PORT: '4100' }).publicBaseUrl).toBe('http://localhost:4100');
  });

  it('requires the public URL and both secrets in production', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(
      /PUBLIC_BASE_URL: Required[\s\S]*PAYMENTS_API_KEY: Required[\s\S]*PAYMENTS_WEBHOOK_SECRET: Required/,
    );
  });

  it('lists every invalid variable at once', () => {
    try {
      parseConfig({ PORT: 'x', PAYMENTS_WEBHOOK_SECRET: 'short', WEBHOOK_MAX_ATTEMPTS: '0' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const paths = (err as ConfigValidationError).issues.map((issue) => issue.path.join('.'));
      expect(paths).toEqual(['PORT', 'PAYMENTS_WEBHOOK_SECRET', 'WEBHOOK_MAX_ATTEMPTS']);
    }
  });
});
