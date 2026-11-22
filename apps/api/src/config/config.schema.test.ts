import { DEV_PAYMENTS_API_KEY } from '@testtix/shared';
import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  DEV_DATABASE_URL,
  DEV_REDIS_URL,
  parseConfig,
} from './config.schema.js';

const PRODUCTION_URLS = {
  DATABASE_URL: 'postgres://db/app',
  REDIS_URL: 'redis://r',
  SMTP_URL: 'smtp://mail:25',
  WEB_BASE_URL: 'https://shop.example.com',
  PAYMENTS_BASE_URL: 'https://payments.example.com',
  PAYMENTS_API_KEY: 'sk_live_long_enough',
  PAYMENTS_WEBHOOK_URL: 'https://api.example.com/webhooks/payments',
};

function parseError(env: Record<string, string>): ConfigValidationError {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigValidationError) return err;
    throw err;
  }
  throw new Error('Expected parseConfig to throw');
}

describe('parseConfig', () => {
  it('applies defaults to an empty environment', () => {
    expect(parseConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databaseUrl: DEV_DATABASE_URL,
      redisUrl: DEV_REDIS_URL,
      healthCheckTimeoutMs: 1000,
      testMode: false,
      testApiKey: undefined,
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
      cookieSecure: false,
      smtpUrl: 'smtp://localhost:1025',
      mailFrom: 'TestTix <no-reply@testtix.test>',
      webBaseUrl: 'http://localhost:5173',
      emailVerificationTtlMs: 24 * 60 * 60 * 1000,
      workerInProcess: true,
      holdSweeper: { enabled: true, intervalMs: 60_000 },
      payments: {
        baseUrl: 'http://localhost:4000',
        apiKey: DEV_PAYMENTS_API_KEY,
        webhookUrl: 'http://host.docker.internal:3000/webhooks/payments',
        timeoutMs: 5000,
      },
      orderPollIntervalMs: 2000,
    });
  });

  it('reads and coerces every variable', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://u:p@db:5432/app',
      REDIS_URL: 'rediss://cache:6380',
      HEALTH_CHECK_TIMEOUT_MS: '250',
      TESTTIX_TEST_MODE: 'true',
      TEST_API_KEY: 'a-long-enough-test-key',
      SESSION_TTL_HOURS: '2',
      COOKIE_SECURE: 'false',
      SMTP_URL: 'smtps://user:pass@mail.example.com:465',
      MAIL_FROM: 'Shop <shop@example.com>',
      WEB_BASE_URL: 'https://shop.example.com/',
      EMAIL_VERIFICATION_TTL_HOURS: '48',
      WORKER_IN_PROCESS: 'false',
      HOLD_SWEEPER_ENABLED: 'false',
      HOLD_SWEEPER_INTERVAL_MS: '5000',
      PAYMENTS_BASE_URL: 'https://payments.example.com/',
      PAYMENTS_API_KEY: 'sk_live_long_enough',
      PAYMENTS_WEBHOOK_URL: 'https://api.example.com/webhooks/payments',
      PAYMENTS_TIMEOUT_MS: '1500',
      ORDER_POLL_INTERVAL_MS: '500',
    });
    expect(config).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
      databaseUrl: 'postgres://u:p@db:5432/app',
      redisUrl: 'rediss://cache:6380',
      healthCheckTimeoutMs: 250,
      testMode: true,
      testApiKey: 'a-long-enough-test-key',
      sessionTtlMs: 2 * 60 * 60 * 1000,
      cookieSecure: false,
      smtpUrl: 'smtps://user:pass@mail.example.com:465',
      mailFrom: 'Shop <shop@example.com>',
      webBaseUrl: 'https://shop.example.com',
      emailVerificationTtlMs: 48 * 60 * 60 * 1000,
      workerInProcess: false,
      holdSweeper: { enabled: false, intervalMs: 5000 },
      payments: {
        baseUrl: 'https://payments.example.com',
        apiKey: 'sk_live_long_enough',
        webhookUrl: 'https://api.example.com/webhooks/payments',
        timeoutMs: 1500,
      },
      orderPollIntervalMs: 500,
    });
  });

  it('points the default webhook URL at PORT', () => {
    expect(parseConfig({ PORT: '3100' }).payments.webhookUrl).toBe(
      'http://host.docker.internal:3100/webhooks/payments',
    );
  });

  it.each([
    ['PAYMENTS_BASE_URL', 'ftp://x'],
    ['PAYMENTS_WEBHOOK_URL', 'not a url'],
    ['PAYMENTS_API_KEY', 'short'],
    ['PAYMENTS_TIMEOUT_MS', '99'],
    ['ORDER_POLL_INTERVAL_MS', '60001'],
  ])('rejects %s=%s', (key, value) => {
    expect(parseError({ [key]: value }).issues[0]?.path).toEqual([key]);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['false', false],
  ])('reads TESTTIX_TEST_MODE=%s as %s', (value, expected) => {
    expect(parseConfig({ TESTTIX_TEST_MODE: value }).testMode).toBe(expected);
  });

  it.each(['1', 'yes', 'on', 'enabled'])('rejects TESTTIX_TEST_MODE=%s', (value) => {
    const error = parseError({ TESTTIX_TEST_MODE: value });
    expect(error.issues.map((issue) => issue.path.join('.'))).toEqual(['TESTTIX_TEST_MODE']);
    expect(error.issues[0]?.message).toBe('Must be true or false');
  });

  it('rejects a TEST_API_KEY shorter than 16 characters', () => {
    expect(parseConfig({ TEST_API_KEY: 'x'.repeat(16) }).testApiKey).toBe('x'.repeat(16));
    const error = parseError({ TEST_API_KEY: 'x'.repeat(15) });
    expect(error.issues[0]?.path).toEqual(['TEST_API_KEY']);
    expect(error.issues[0]?.message).toBe('Must be at least 16 characters');
  });

  it.each([
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{ NODE_ENV: 'production', ...PRODUCTION_URLS }, true],
    [{ NODE_ENV: 'development', COOKIE_SECURE: 'true' }, true],
  ])('derives cookieSecure from %j', (env, expected) => {
    expect(parseConfig(env).cookieSecure).toBe(expected);
  });

  it.each(['0', '721', '1.5'])('rejects EMAIL_VERIFICATION_TTL_HOURS=%s', (value) => {
    expect(parseError({ EMAIL_VERIFICATION_TTL_HOURS: value }).issues[0]?.path).toEqual([
      'EMAIL_VERIFICATION_TTL_HOURS',
    ]);
  });

  it.each(['99', '86400001', '1.5'])('rejects HOLD_SWEEPER_INTERVAL_MS=%s', (value) => {
    expect(parseError({ HOLD_SWEEPER_INTERVAL_MS: value }).issues[0]?.path).toEqual([
      'HOLD_SWEEPER_INTERVAL_MS',
    ]);
  });

  it.each(['WORKER_IN_PROCESS', 'HOLD_SWEEPER_ENABLED'])('rejects %s=1', (key) => {
    expect(parseError({ [key]: '1' }).issues[0]?.message).toBe('Must be true or false');
  });

  it.each(['0', '8761', '1.5'])('rejects SESSION_TTL_HOURS=%s', (value) => {
    expect(parseError({ SESSION_TTL_HOURS: value }).issues[0]?.path).toEqual(['SESSION_TTL_HOURS']);
  });

  it('ignores unrelated variables', () => {
    expect(parseConfig({ PATH: '/usr/bin', HOME: '/home/me' }).port).toBe(3000);
  });

  it('treats empty values as unset', () => {
    expect(parseConfig({ PORT: '', LOG_LEVEL: '' })).toMatchObject({
      port: 3000,
      logLevel: 'info',
    });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseConfig({}))).toBe(true);
  });

  it.each([
    ['0', 'too small'],
    ['65536', 'too big'],
    ['3000.5', 'not an integer'],
    ['abc', 'not a number'],
  ])('rejects PORT=%s (%s)', (port) => {
    expect(parseError({ PORT: port }).issues.map((issue) => issue.path.join('.'))).toEqual([
      'PORT',
    ]);
  });

  it.each(['1', '65535'])('accepts boundary PORT=%s', (port) => {
    expect(parseConfig({ PORT: port }).port).toBe(Number(port));
  });

  it('rejects an unknown NODE_ENV and LOG_LEVEL', () => {
    const paths = parseError({ NODE_ENV: 'staging', LOG_LEVEL: 'verbose' }).issues.map((issue) =>
      issue.path.join('.'),
    );
    expect(paths).toEqual(['NODE_ENV', 'LOG_LEVEL']);
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost:3306/app'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['SMTP_URL', 'http://localhost:1025'],
    ['WEB_BASE_URL', 'ftp://shop.example.com'],
  ])('rejects %s=%s', (key, value) => {
    const error = parseError({ [key]: value });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toEqual([key]);
  });

  it('requires the connection URLs, WEB_BASE_URL and the payment provider in production', () => {
    const error = parseError({ NODE_ENV: 'production' });
    expect(error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'SMTP_URL',
      'WEB_BASE_URL',
      'PAYMENTS_BASE_URL',
      'PAYMENTS_API_KEY',
      'PAYMENTS_WEBHOOK_URL',
    ]);
    expect(error.issues[0]?.message).toBe('Required when NODE_ENV is production');
  });

  it('reports every problem in one readable message', () => {
    const error = parseError({ PORT: '-1', REDIS_URL: 'nope' });
    expect(error.message).toMatch(
      /^Invalid environment configuration:\n {2}- PORT: .+\n {2}- REDIS_URL: .+$/,
    );
  });
});
