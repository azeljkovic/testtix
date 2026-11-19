import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC (not the default transformer) emits the decorator metadata NestJS needs for DI.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
