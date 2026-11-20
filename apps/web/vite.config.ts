import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// The root `.env` (see `.env.example`) configures the dev server too.
const envDir = '../..';
const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:3000';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const apiProxyTarget = env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET;

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        // The browser calls `/api/...` on its own origin; the dev server forwards it without the prefix.
        '/api': {
          target: apiProxyTarget,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/testing/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
