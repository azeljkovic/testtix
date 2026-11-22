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
        // Real HTTP: the provider delivers webhooks to a receiver stub on a local port.
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
