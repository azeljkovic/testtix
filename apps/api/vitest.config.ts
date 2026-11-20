import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC (not the default transformer) emits the decorator metadata NestJS needs for DI.
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // Real Postgres and Redis: see `src/testing/integration/global-setup.ts`.
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['src/testing/integration/global-setup.ts'],
          setupFiles: ['src/testing/integration/setup.ts'],
          // Files share one database and each one starts by emptying it, so they run in sequence.
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
