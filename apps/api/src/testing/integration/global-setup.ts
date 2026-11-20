import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

import { checkTestDatabaseUrl, checkTestRedisUrl } from './targets.js';
import './targets-context.js';

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
const repoRoot = join(apiRoot, '../..');

type Stop = () => Promise<unknown>;

/**
 * Runs once before the integration tests:
 * 1. Uses `TEST_DATABASE_URL` / `TEST_REDIS_URL` when set, and starts a Testcontainers
 *    container for each one that isn't (images from `docker/compose.yml`).
 * 2. Applies the migrations with `prisma migrate deploy`.
 * 3. Hands the URLs to the tests (`inject('integration')`).
 * The returned teardown stops the containers it started.
 */
export default async function setup(project: TestProject): Promise<Stop> {
  // Like `pnpm dev`, read the repo root `.env`; variables already in the environment win.
  const rootEnv = join(repoRoot, '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const stops: Stop[] = [];
  const teardown: Stop = () => Promise.all(stops.map((stop) => stop()));
  try {
    const [databaseUrl, redisUrl] = await Promise.all([
      startPostgres(stops, process.env.TEST_DATABASE_URL),
      startRedis(stops, process.env.TEST_REDIS_URL),
    ]);
    await migrate(databaseUrl);
    project.provide('integration', { databaseUrl, redisUrl });
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}

async function startPostgres(stops: Stop[], fromEnv: string | undefined): Promise<string> {
  if (fromEnv) return checkTestDatabaseUrl(fromEnv);
  const container = await new PostgreSqlContainer(composeImage('postgres'))
    .withDatabase('testtix_test')
    .withUsername('testtix')
    .withPassword('testtix')
    // Test data is throwaway; keeping it in memory makes the database faster.
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    .start();
  stops.push(() => container.stop());
  return container.getConnectionUri();
}

async function startRedis(stops: Stop[], fromEnv: string | undefined): Promise<string> {
  if (fromEnv) return checkTestRedisUrl(fromEnv);
  const container = await new RedisContainer(composeImage('redis')).start();
  stops.push(() => container.stop());
  return container.getConnectionUrl();
}

/** Reads a service's image from `docker/compose.yml`, so tests and local infra run the same version. */
function composeImage(service: 'postgres' | 'redis'): string {
  const compose = readFileSync(join(repoRoot, 'docker/compose.yml'), 'utf8');
  const image = new RegExp(`^\\s+image:\\s*(${service}:\\S+)\\s*$`, 'm').exec(compose)?.[1];
  if (image === undefined) throw new Error(`No "${service}:<tag>" image in docker/compose.yml`);
  return image;
}

async function migrate(databaseUrl: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('prisma/package.json')), 'build/index.js');
  try {
    await execFileAsync(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
  } catch (err) {
    const { stdout = '', stderr = '' } = err as { stdout?: string; stderr?: string };
    throw new Error(`prisma migrate deploy failed:\n${stdout}${stderr}`, { cause: err });
  }
}
