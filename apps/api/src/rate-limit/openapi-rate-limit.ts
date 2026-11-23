import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { LOAD_TEST_KEY_HEADER, PROBLEM_CONTENT_TYPE } from '@testtix/shared';

import { effectiveGroups, isRateLimitGroup, type RateLimitGroup } from './rate-limit-groups.js';
import { NO_RATE_LIMIT_EXTENSION, RATE_LIMIT_GROUPS_EXTENSION } from './no-rate-limit.decorator.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Env var of each group's limit. */
const GROUP_ENV: Record<RateLimitGroup, string> = {
  default: 'RATE_LIMIT_DEFAULT',
  auth: 'RATE_LIMIT_AUTH',
  testApi: 'RATE_LIMIT_TEST_API',
  verificationResend: 'RATE_LIMIT_VERIFICATION_RESEND',
};

function describeGroups(groups: readonly RateLimitGroup[]): string {
  return groups
    .map((group) =>
      group === 'verificationResend'
        ? `\`${group}\` (per user, \`${GROUP_ENV[group]}\`)`
        : `\`${group}\` (per client address, \`${GROUP_ENV[group]}\`)`,
    )
    .join(' and ');
}

/**
 * Documents the 429 of every rate-limited operation, from the markers `@RateLimit()` and
 * `@NoRateLimit()` leave on it (then removes the markers). The limits themselves are server
 * settings, so the spec names the groups and their env vars, not numbers.
 */
export function addRateLimitDocs(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const marked = pathItem[method] as (OperationObject & Record<string, unknown>) | undefined;
      if (marked === undefined) continue;
      const {
        [RATE_LIMIT_GROUPS_EXTENSION]: groupsMarker,
        [NO_RATE_LIMIT_EXTENSION]: noDefaultMarker,
        ...operation
      } = marked;
      pathItem[method] = operation;

      const routeGroups = Array.isArray(groupsMarker)
        ? groupsMarker.filter((group): group is RateLimitGroup => isRateLimitGroup(String(group)))
        : [];
      const groups = effectiveGroups(routeGroups, noDefaultMarker === true);
      if (groups.length === 0) continue;
      operation.responses['429'] ??= {
        description: `Rate limited (type \`rate-limited\`): too many requests in the rate-limit group ${describeGroups(groups)}. Wait \`Retry-After\` seconds. Requests with the server's \`${LOAD_TEST_KEY_HEADER}\` skip every limit.`,
        headers: {
          'Retry-After': {
            description: 'Seconds until the limit resets.',
            schema: { type: 'integer', minimum: 1 },
          },
        },
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } },
        },
      };
    }
  }
  return document;
}
