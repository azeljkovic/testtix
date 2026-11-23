import type { OpenAPIObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';

import { createOpenApiDocument } from '../openapi/openapi-document.js';
import { describeWindow, effectiveGroups } from './rate-limit-groups.js';

describe('effectiveGroups', () => {
  it.each([
    [[], false, ['default']],
    [['auth'], false, ['default', 'auth']],
    [['verificationResend'], false, ['default', 'verificationResend']],
    [['testApi'], false, ['testApi']],
    [['default', 'auth', 'auth'], false, ['default', 'auth']],
    [[], true, []],
    [['auth'], true, ['auth']],
  ] as const)('%j (no default: %s) → %j', (groups, noDefault, expected) => {
    expect(effectiveGroups(groups, noDefault)).toEqual(expected);
  });
});

describe('describeWindow', () => {
  it.each([
    [1000, 'second'],
    [30_000, '30 seconds'],
    [60_000, 'minute'],
    [90_000, '90 seconds'],
    [15 * 60_000, '15 minutes'],
    [3_600_000, 'hour'],
    [24 * 3_600_000, '24 hours'],
  ])('%i ms → %s', (ms, expected) => {
    expect(describeWindow(ms)).toBe(expected);
  });
});

describe('rate limits in the OpenAPI document', () => {
  type Operation = { responses: Record<string, { description?: string }> } & Record<
    string,
    unknown
  >;
  const operation = (document: OpenAPIObject, path: string, method: string) =>
    (document.paths[path] as Record<string, Operation> | undefined)?.[method];

  it('documents the 429 and the groups of each limited operation', async () => {
    const document = await createOpenApiDocument();

    const limited = [
      ['/events', 'get', /`default`/],
      ['/auth/login', 'post', /`default` \(per client address, `RATE_LIMIT_DEFAULT`\) and `auth`/],
      ['/auth/verify-email/resend', 'post', /`verificationResend` \(per user/],
      ['/__test/reset', 'post', /group `testApi`/],
    ] as const;
    for (const [path, method, groups] of limited) {
      const response = operation(document, path, method)?.responses['429'];
      expect(response?.description, `${method} ${path}`).toMatch(groups);
      expect(response, `${method} ${path}`).toHaveProperty(['headers', 'Retry-After']);
    }
    expect(operation(document, '/__test/reset', 'post')?.responses['429']?.description).not.toMatch(
      /`default`/,
    );
  });

  it('leaves out operations without limits, and removes the markers', async () => {
    const document = await createOpenApiDocument();

    for (const [path, method] of [
      ['/health', 'get'],
      ['/health/ready', 'get'],
      ['/metrics', 'get'],
      ['/webhooks/payments', 'post'],
    ] as const) {
      expect(operation(document, path, method)?.responses, `${method} ${path}`).not.toHaveProperty(
        '429',
      );
    }
    expect(JSON.stringify(document)).not.toMatch(/x-testtix-(no-)?rate-limit/);
  });
});
