import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  DEV_DATABASE_URL,
  DEV_REDIS_URL,
  parseConfig,
} from './config.schema.js';

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
    });
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
    [{ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/app', REDIS_URL: 'redis://r' }, true],
    [{ NODE_ENV: 'development', COOKIE_SECURE: 'true' }, true],
  ])('derives cookieSecure from %j', (env, expected) => {
    expect(parseConfig(env).cookieSecure).toBe(expected);
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
  ])('rejects %s=%s', (key, value) => {
    const error = parseError({ [key]: value });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toEqual([key]);
  });

  it('requires DATABASE_URL and REDIS_URL in production', () => {
    const error = parseError({ NODE_ENV: 'production' });
    expect(error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
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
