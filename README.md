# TestTix

A sample event ticket shop — concerts, talks and meetups — built as a realistic target for software testing practice.

Ticket sales naturally produce the failure modes worth practising on: race conditions on the last seat, time-dependent seat holds, ticket drops with a waiting room, asynchronous checkout with emailed tickets, and a seat map that is hard to make accessible.

> **Status:** early development. The app is being built in small, verifiable chunks — see the [development plan](docs/development-plan.md) and [tech stack decisions](docs/tech-stack-decisions.md).

## Repository layout

```
apps/
  web/             React frontend (Vite SPA)
  api/             NestJS REST API
  fake-payments/   fake hosted payment provider (separate service)
packages/
  shared/          Zod schemas, shared types, constants
  config/          shared tsconfig, ESLint and Prettier configs
docker/            compose files, Dockerfiles
```

Tests that are tightly coupled to the code (unit, component, API integration) live in this repo. UI end-to-end, API end-to-end and performance (k6) tests live in a separate repository and treat TestTix as a black box.

## Quick start

Requirements: Node.js 24 (see `.nvmrc`), pnpm 10 (via [Corepack](https://nodejs.org/api/corepack.html)) and Docker with Compose v2.

```sh
nvm use            # or install Node 24 another way
corepack enable    # provides the pnpm version pinned in package.json
pnpm install
pnpm build
pnpm infra:up      # Postgres, Redis, Mailpit and the fake payment provider in Docker
pnpm db:deploy     # apply database migrations to the local Postgres
pnpm db:seed       # load the deterministic sample data (venues, events, tickets)
```

## API

The NestJS API lives in `apps/api`. With local infra running:

```sh
pnpm --filter @testtix/api dev     # rebuilds on change, then restarts; reads the root .env if present
curl -i http://localhost:3000/health/ready
```

| Endpoint            | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `GET /health`       | Liveness: 200 while the process is up                                          |
| `GET /health/ready` | Readiness: checks Postgres and Redis; 503 with per-check status if one is down |
| `GET /metrics`      | Prometheus metrics: process, requests, holds, orders, waiting rooms, jobs      |
| `/auth/*`           | Register, log in, log out, current user, CSRF token (cookie sessions)          |
| `/docs`             | Swagger UI                                                                     |
| `/openapi.json`     | OpenAPI 3 spec                                                                 |
| `/__test/*`         | Test API, only with `TESTTIX_TEST_MODE=true` (404 otherwise)                   |

Configuration comes from environment variables (see the API section of `.env.example`). They are validated on startup, and the API exits with a list of problems if one is invalid. Logs are JSON lines on stdout; pipe them through `npx pino-pretty` for a readable view. Error responses, request IDs, accounts and sessions (with the seeded logins), test mode and the controllable clock are described in the [testing guide](docs/testing-guide.md).

### Background jobs

Background jobs (BullMQ on Redis) run inside the API process by default, so `pnpm dev` needs nothing extra. Today that is the hold sweeper, which deletes expired holds every `HOLD_SWEEPER_INTERVAL_MS`, order processing, which confirms or fails orders after their payment webhook (`JOB_PROCESSING_DELAY_MS`), and the waiting-room admission job, which lets customers of ticket drops in every `QUEUE_ADMISSION_INTERVAL_MS`; without a worker, paid orders stay `PROCESSING` and nobody leaves a waiting room. To run the worker as its own process, so it can scale apart from the API, set `WORKER_IN_PROCESS=false` for the API and start the worker with the same environment:

```sh
pnpm --filter @testtix/api build
pnpm --filter @testtix/api start:worker   # node dist/worker.js; reads the root .env if present
```

The worker answers `GET /health` and `GET /health/ready` (Postgres and Redis) on `WORKER_PORT` (default 3001), for container health checks, and `GET /metrics` with its job metrics; it serves nothing else.

## Web app

The React single-page app lives in `apps/web` (Vite, React Router, TanStack Query, Tailwind CSS, React Aria Components).

```sh
pnpm dev                              # API and web app together; or run one:
pnpm --filter @testtix/web dev        # http://localhost:5173
```

The dev server forwards `/api/*` to the API with the prefix removed (`/api/health` → `http://127.0.0.1:3000/health`), so the browser only ever talks to its own origin. Set `API_PROXY_TARGET` or `WEB_PORT` in the root `.env` to change either. The footer shows whether the API answers. `pnpm --filter @testtix/web build` writes the static site to `apps/web/dist`.

Accounts: register at `/register`, open the link from the verification email in Mailpit (<http://localhost:8025>), and log in at `/login`. `/account` needs a login and `/admin` an admin; see the [testing guide](docs/testing-guide.md#account-pages). Log in as the seeded admin (`admin@testtix.test`, [seeded accounts](docs/testing-guide.md#seeded-accounts)) to create venues and events, release tickets and publish them under `/admin` ([admin pages](docs/testing-guide.md#admin-pages)).

The web app calls the API through a typed client generated from the API's OpenAPI spec. After changing an API route or schema, regenerate the spec and the client types, then commit both. CI fails when they are stale.

```sh
pnpm openapi          # apps/api/openapi.json and apps/web/src/api/generated/openapi.ts
pnpm openapi:check    # what CI runs: regenerate, then fail on any difference
```

## Database

The schema lives in `apps/api/prisma/schema.prisma` and is managed with Prisma Migrate. The generated Prisma client (`apps/api/src/generated/`) is not committed; `pnpm build`, `typecheck`, `lint` and `test` regenerate it.

```sh
pnpm db:deploy                                         # apply pending migrations
pnpm db:migrate --name add-events                      # after editing the schema: create and apply a migration
pnpm db:reset                                          # drop the local database and re-apply every migration
pnpm db:seed                                           # load the sample data into an empty database
```

The seed is deterministic: the same venues, events and IDs on every run, with dates relative to the day it runs. It refuses to run on a database that already has venues or events, so start over with `pnpm db:reset && pnpm db:seed`. With the API running in test mode, `curl -X POST http://localhost:3000/__test/reset` does the same in one call (and resets the test clock). The fixtures, the reset and the additive seed scenarios are described in [`docs/testing-guide.md`](docs/testing-guide.md#seed-data).

## Tests

`pnpm test` runs the unit and component tests. They need no infrastructure: tests that boot the API replace Postgres and Redis with fakes, and the web app's component tests (Vitest, React Testing Library, jsdom) answer API calls with [MSW](https://mswjs.io/) and check pages with axe-core (`vitest-axe`).

`pnpm test:integration` runs the API integration tests (`*.int.test.ts`) against a real Postgres and Redis:

- By default it starts both with [Testcontainers](https://testcontainers.com/), so it only needs Docker running.
- To use services you already have, set `TEST_DATABASE_URL` and `TEST_REDIS_URL` (in the environment or the root `.env`). The tests delete all data in them, so the database must be named `test` or end in `_test`, and Redis must use a database other than 0. With local infra running:

  ```sh
  docker compose --project-directory . -f docker/compose.yml exec postgres createdb -U testtix testtix_test
  TEST_DATABASE_URL=postgresql://testtix:testtix@localhost:5432/testtix_test \
  TEST_REDIS_URL=redis://localhost:6379/1 pnpm test:integration
  ```

Each run applies the migrations, and each test file starts with empty tables and an empty Redis database.

`pnpm docs:examples` runs every shell example of the [testing guide](docs/testing-guide.md) against the local API in test mode (`pnpm --filter @testtix/api dev` with local infra up), with a `POST /__test/reset` before each, so it **wipes the local data**. A comment before a block can group it with others or skip it (see `scripts/check-guide-examples.mjs`). CI runs it on every PR.

## Local infrastructure

`docker/compose.yml` runs the services the app depends on. `pnpm infra:up` starts them and waits until every health check passes; `pnpm infra:check` then checks each one from the host (a query, a `PING`, an email delivered to Mailpit, a payment session).

| Service       | Address                                    | Notes                                                                                     |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| PostgreSQL    | `localhost:5432`                           | user, password and database: `testtix`                                                    |
| Redis         | `localhost:6379`                           | no password, append-only persistence                                                      |
| Mailpit       | SMTP `localhost:1025`, UI `localhost:8025` | catches every email the app sends; any SMTP login is accepted                             |
| Fake payments | `localhost:4000`                           | hosted payment page and signed webhooks ([testing guide](docs/testing-guide.md#payments)) |

Open the Mailpit inbox at <http://localhost:8025>. Ports bind to `127.0.0.1` only. If one is already taken (for example by a native Postgres), copy `.env.example` to `.env` and change it there.

The fake payment provider (`apps/fake-payments`) is built from its own Dockerfile the first time. After changing its code, rebuild it with `pnpm infra:up --build`, or run it on the host instead with `pnpm --filter @testtix/fake-payments start` (after `pnpm build`; stop the container first, since both use port 4000). It reaches an API running on the host at `host.docker.internal`.

Data lives in named Docker volumes, so it survives `pnpm infra:down`. Use `pnpm infra:reset` to delete it and start clean.

The compose file has two profiles: `full` runs the app itself in containers ([below](#running-everything-in-containers)), and `observability` adds Prometheus and Grafana ([dashboards](#dashboards-prometheus-and-grafana)).

## Running everything in containers

The `full` compose profile runs the whole shop from Docker images, with nothing but Docker on the host: the services above (with the same data volumes), plus the app at the same addresses as `pnpm dev`.

```sh
pnpm full:up --build   # build the images, start everything, wait until healthy
pnpm full:check        # smoke test: health checks, web app, a test purchase (resets the data)
pnpm full:down         # stop every container (pnpm full:reset also deletes the data)
```

| Service   | What it runs                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `migrate` | `prisma migrate deploy`, then the seed if the database is empty; runs once before `api` and `worker` start                        |
| `api`     | the API, `API_REPLICAS` copies (default 2), reachable only through `web`                                                          |
| `worker`  | the background jobs (`node dist/worker.js`), with health checks on port 3001 inside the container                                 |
| `web`     | Caddy: the web app at <http://localhost:5173> (API under `/api`) and the API at <http://localhost:3000>, spread over the replicas |

The app's containers use the API's production settings (`NODE_ENV=production`) with test mode on (`TESTTIX_TEST_MODE=true`), so the [test API](docs/testing-guide.md) works and the testing guide's examples run against it. Other API settings from the root `.env` or the shell are passed through (`TEST_API_KEY`, `LOAD_TEST_KEY`, `RATE_LIMIT_*`, `JOB_PROCESSING_DELAY_MS`…; see `docker/compose.yml`); the ones that wire the containers together are fixed. `WEB_PORT` and `PORT` choose the host ports. Stop `pnpm dev` first, since both use the same ports.

**Published images.** CI pushes every commit on `main` to GHCR as `ghcr.io/azeljkovic/testtix/{api,web,fake-payments}:sha-<commit>` (and `:main`), and each release adds `:<version>`, `:<major>.<minor>` and `:latest` to its commit's images (linux/amd64; see [Releasing](docs/releasing.md)). To run those instead of building:

```sh
export TESTTIX_IMAGE_REGISTRY=ghcr.io/azeljkovic/testtix TESTTIX_IMAGE_TAG=main
docker compose --project-directory . -f docker/compose.yml --profile full pull
pnpm full:up
```

The api image runs the API by default (`node dist/main.js`, port 3000); the same image is the worker (`node dist/worker.js`) and runs the migrations (`prisma migrate deploy`, then `node dist/seed/main.js --if-empty`). Every image runs as a non-root user and has a health check.

## Dashboards (Prometheus and Grafana)

The `observability` compose profile runs Prometheus and Grafana with a provisioned **Ticket drop** dashboard: request rate, latency and status codes per route, 409s and 429s, waiting-room queues and admissions, hold outcomes and held tickets, orders by status, background job lag, queue depth and run time, and each process' event loop, CPU and memory. It's meant for watching k6 runs and drops.

```sh
pnpm full:up --build        # the app in containers (Prometheus scrapes these)
pnpm observability:up       # Prometheus at http://localhost:9090, Grafana at http://localhost:3030
pnpm observability:load     # a short drop with 30 customers, to make the panels move
pnpm observability:check    # smoke test: targets up, dashboard provisioned, its queries valid, a short drop
pnpm observability:down     # stop Prometheus and Grafana, keeping their data
```

Grafana opens on the dashboard, without a login (anyone who reaches the port is an admin, so it binds to `127.0.0.1` like every other port). Prometheus scrapes every 5 s: each API replica (found through Docker's DNS for `api`, so `API_REPLICAS` changes are picked up) and the worker. To watch `pnpm dev` on the host instead, start the profile with `OBSERVABILITY_TARGETS=host pnpm observability:up` (the API at `host.docker.internal:3000`, with the worker in it); on Linux, the API must listen on `0.0.0.0` (`HOST`) for that. `PROMETHEUS_PORT`, `GRAFANA_PORT` and `PROMETHEUS_RETENTION` (default `7d`) change the defaults. `pnpm full:reset` deletes their data too.

`pnpm observability:load` (`scripts/drop-load.mjs`, `--customers <n>`, up to 250) adds a `drop-open-now` scenario and test customers, who queue, hold two of the first free seats (customers let in together collide, so there are 409s), check out and pay with a test card: most succeed, some are declined, some never pay. It only adds data. Without `LOAD_TEST_KEY` on the server, large runs hit the default rate limit and wait out the 429s; with it set on both sides, nothing is limited.

The dashboard is `docker/observability/grafana/dashboards/ticket-drop.json`. Change it there (Grafana reloads it within 10 s); edits made in the UI can't be saved over it, only as a copy. The metrics themselves are listed in the [testing guide](docs/testing-guide.md#metrics).

## Hosted demo

A public demo runs the published images on one server behind Caddy with automatic TLS: the shop, the API on its own host name, the payment page and Mailpit (behind a login), with test mode on and the data reset every night. The **Demo deploy** workflow deploys every commit on `main` once CI has pushed its images, and `pnpm demo:check` smoke-tests it from anywhere. Setup, deploys, rollbacks and the nightly reset are in [docs/hosted-demo.md](docs/hosted-demo.md); what testers need to know is in the [testing guide](docs/testing-guide.md#hosted-demo).

## Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please) from the Conventional Commits on `main`: it keeps a release PR open with the next version and `CHANGELOG.md`, and merging it tags the release, creates the GitHub Release with `openapi.json` attached, gives the commit's tested images their version tags on GHCR and notifies the tests repository. `0.x` releases are GitHub pre-releases. How it works, the setup and the tests repo's payload are in [docs/releasing.md](docs/releasing.md).

## Scripts

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                 | Runs the API and the web app in watch mode                  |
| `pnpm build`               | Builds every package (Turborepo, cached)                    |
| `pnpm typecheck`           | Type-checks every package with `tsc --noEmit`               |
| `pnpm lint`                | Lints every package with ESLint                             |
| `pnpm test`                | Runs unit tests with Vitest                                 |
| `pnpm test:integration`    | Runs API integration tests (needs Docker, or `TEST_*` URLs) |
| `pnpm openapi`             | Regenerates the OpenAPI spec and the web client types       |
| `pnpm openapi:check`       | Fails if the committed spec or client types are stale       |
| `pnpm docs:examples`       | Runs the testing guide's examples against the local API     |
| `pnpm db:deploy`           | Applies database migrations                                 |
| `pnpm db:migrate`          | Creates and applies a migration (development)               |
| `pnpm db:reset`            | Drops the local database and re-applies every migration     |
| `pnpm db:seed`             | Builds the API and seeds an empty database                  |
| `pnpm format`              | Formats the repo with Prettier                              |
| `pnpm format:check`        | Checks formatting without writing                           |
| `pnpm clean`               | Removes build output and Turborepo caches                   |
| `pnpm infra:up`            | Starts local infra and waits until healthy                  |
| `pnpm infra:check`         | Smoke-tests the running local infra                         |
| `pnpm infra:down`          | Stops local infra, keeping its data                         |
| `pnpm infra:reset`         | Stops local infra and deletes its data                      |
| `pnpm full:up`             | Starts the whole app in containers (`--build` to rebuild)   |
| `pnpm full:check`          | Smoke-tests the running containers (resets the data)        |
| `pnpm full:down`           | Stops every container (infra too), keeping the data         |
| `pnpm full:reset`          | Stops every container and deletes the data                  |
| `pnpm observability:up`    | Starts Prometheus and Grafana                               |
| `pnpm observability:check` | Smoke-tests them, with a short drop (adds data)             |
| `pnpm observability:load`  | Runs a short drop against the API to fill the dashboard     |
| `pnpm observability:down`  | Stops Prometheus and Grafana, keeping their data            |
| `pnpm demo:check`          | Smoke-tests the hosted demo over HTTPS (adds data)          |

## Tech stack

TypeScript (strict) everywhere · React + Vite · NestJS · PostgreSQL + Prisma · Redis + BullMQ · Mailpit · Docker Compose · Vitest.

## Roadmap

| Milestone                      | What you can do at the end                                                    |
| ------------------------------ | ----------------------------------------------------------------------------- |
| M0 Foundation                  | Run the empty app shell, API health checks and OpenAPI docs; CI is green      |
| M1 Accounts & testability core | Register, verify email, log in; reset data, seed scenarios, control the clock |
| M2 Catalogue                   | Admins create events; customers browse, filter, search and paginate           |
| M3 Seats & holds               | Pick seats or general-admission tickets and hold them with a countdown        |
| M4 Checkout & tickets          | Pay with test cards; receive an e-ticket with QR code and PDF by email        |
| M5 Ticket drops                | Queue in a waiting room for a scheduled ticket drop                           |
| M6 Ship v1.0                   | Docker images, observability dashboards, a hosted demo and automated releases |

## License

[MIT](LICENSE)
