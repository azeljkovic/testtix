/**
 * Integration tests empty their database and Redis before every test file. These checks make
 * sure a `TEST_*` URL can't point at data someone cares about (for example the dev database).
 */

/** The database name must be `test` or end in `_test`, e.g. `testtix_test`. */
export function checkTestDatabaseUrl(value: string): string {
  const url = parseUrl('TEST_DATABASE_URL', value, ['postgres:', 'postgresql:']);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/(^|_)test$/.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL must name a database called "test" or ending in "_test" (got "${name}"). ` +
        'The integration tests delete all of its data.',
    );
  }
  return value;
}

/** The URL must select a Redis database other than 0, which the app uses by default. */
export function checkTestRedisUrl(value: string): string {
  const url = parseUrl('TEST_REDIS_URL', value, ['redis:', 'rediss:']);
  const db = url.pathname.slice(1);
  if (!/^[1-9]\d*$/.test(db)) {
    throw new Error(
      `TEST_REDIS_URL must select a Redis database other than 0, e.g. redis://localhost:6379/1 (got "/${db}"). ` +
        'The integration tests delete all of its data.',
    );
  }
  return value;
}

/** Mailpit only needs a well-formed URL: tests never delete its messages, they search by recipient. */
export function checkTestSmtpUrl(value: string): string {
  parseUrl('TEST_SMTP_URL', value, ['smtp:', 'smtps:']);
  return value;
}

/** A running fake payment provider. It holds nothing worth protecting (sessions are in memory). */
export function checkTestPaymentsUrl(value: string): string {
  parseUrl('TEST_PAYMENTS_URL', value, ['http:', 'https:']);
  return value.replace(/\/+$/, '');
}

export function checkTestMailpitUrl(value: string): string {
  parseUrl('TEST_MAILPIT_URL', value, ['http:', 'https:']);
  return value.replace(/\/+$/, '');
}

function parseUrl(name: string, value: string, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${protocols.map((p) => `${p}//`).join(' or ')}`);
  }
  return url;
}
