/**
 * The background worker as its own process: `node dist/worker.js` (`pnpm start:worker`). Run it
 * with `WORKER_IN_PROCESS=false` on the API, so jobs are processed here and the two scale apart.
 * It reads the same environment variables as the API (it ignores `WORKER_IN_PROCESS`), and serves
 * only `GET /health`, `GET /health/ready` (container health checks) and `GET /metrics` (Prometheus)
 * on `HOST`:`WORKER_PORT`.
 */
import 'reflect-metadata';

import { Logger } from 'nestjs-pino';

import { ConfigValidationError, parseConfig } from './config/config.schema.js';
import { createWorkerApp } from './worker.setup.js';

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigValidationError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const app = await createWorkerApp(config);
  await app.listen(config.workerPort, config.host);
  app
    .get(Logger)
    .log(
      `TestTix worker started (health checks at http://${config.host}:${config.workerPort}/health)`,
      'Bootstrap',
    );
}

await bootstrap();
