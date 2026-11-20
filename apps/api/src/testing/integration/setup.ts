import { beforeAll, inject } from 'vitest';

import { resetState } from './reset.js';
import './targets-context.js';

// Runs before every integration test file, so each file starts from empty tables and Redis.
// Files run one at a time (`fileParallelism: false`), so they never see each other's data.
beforeAll(async () => {
  await resetState(inject('integration'));
});
