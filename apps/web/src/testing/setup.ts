import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
// `vitest-axe/matchers` is typed as type-only at the package root; the dist module has the value.
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js';

import { server } from './msw-server.js';

expect.extend({ toHaveNoViolations });

// Any request without a handler fails the test, so tests never reach a real network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  // Vitest globals are off, so Testing Library can't register its own cleanup.
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
