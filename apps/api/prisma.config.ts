import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads `.env` itself. Load the repo root `.env` like `pnpm dev` does;
// variables already set in the environment win.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma db seed` (`pnpm db:seed`) runs the compiled seed CLI, so build the API first.
    seed: 'node --enable-source-maps dist/seed/main.js',
  },
  datasource: {
    // Same default as `DEV_DATABASE_URL` in src/config/config.schema.ts (matches docker/compose.yml).
    url: process.env.DATABASE_URL ?? 'postgresql://testtix:testtix@localhost:5432/testtix',
  },
});
