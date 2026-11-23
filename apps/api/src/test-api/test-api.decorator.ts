import { applyDecorators, Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public, SkipCsrf } from '../auth/auth.decorators.js';
import { RateLimit } from '../rate-limit/rate-limit.decorators.js';

/**
 * A test API controller under `/__test/<path>`. Test endpoints never read the session cookie, so
 * they are open to anonymous callers and exempt from the CSRF check (scripts call them with curl).
 * Global-effect endpoints add `@RequiresTestKey()`. They share the `testApi` rate limit instead of
 * the default one.
 */
export function TestApiController(path: string): ClassDecorator {
  return applyDecorators(
    ApiTags('test'),
    Controller(`__test/${path}`),
    Public(),
    SkipCsrf(),
    RateLimit('testApi'),
  );
}
