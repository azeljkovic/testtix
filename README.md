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
pnpm infra:up      # Postgres, Redis and Mailpit in Docker
pnpm db:deploy     # apply database migrations to the local Postgres
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
| `GET /metrics`      | Prometheus metrics (Node.js process defaults)                                  |
| `/docs`             | Swagger UI                                                                     |
| `/openapi.json`     | OpenAPI 3 spec                                                                 |

Configuration comes from environment variables (see the API section of `.env.example`). They are validated on startup, and the API exits with a list of problems if one is invalid. Logs are JSON lines on stdout; pipe them through `npx pino-pretty` for a readable view. Error responses and request IDs are described in the [testing guide](docs/testing-guide.md).

## Web app

The React single-page app lives in `apps/web` (Vite, React Router, TanStack Query, Tailwind CSS, React Aria Components).

```sh
pnpm dev                              # API and web app together; or run one:
pnpm --filter @testtix/web dev        # http://localhost:5173
```

The dev server forwards `/api/*` to the API with the prefix removed (`/api/health` → `http://127.0.0.1:3000/health`), so the browser only ever talks to its own origin. Set `API_PROXY_TARGET` or `WEB_PORT` in the root `.env` to change either. The footer shows whether the API answers. `pnpm --filter @testtix/web build` writes the static site to `apps/web/dist`.

## Database

The schema lives in `apps/api/prisma/schema.prisma` and is managed with Prisma Migrate. The generated Prisma client (`apps/api/src/generated/`) is not committed; `pnpm build`, `typecheck`, `lint` and `test` regenerate it.

```sh
pnpm db:deploy                                         # apply pending migrations
pnpm db:migrate --name add-events                      # after editing the schema: create and apply a migration
pnpm --filter @testtix/api db:reset                    # drop the local database and re-apply every migration
```

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

## Local infrastructure

`docker/compose.yml` runs the services the app depends on. `pnpm infra:up` starts them and waits until every health check passes; `pnpm infra:check` then checks each one from the host (a query, a `PING`, an email delivered to Mailpit).

| Service    | Address                                    | Notes                                                         |
| ---------- | ------------------------------------------ | ------------------------------------------------------------- |
| PostgreSQL | `localhost:5432`                           | user, password and database: `testtix`                        |
| Redis      | `localhost:6379`                           | no password, append-only persistence                          |
| Mailpit    | SMTP `localhost:1025`, UI `localhost:8025` | catches every email the app sends; any SMTP login is accepted |

Open the Mailpit inbox at <http://localhost:8025>. Ports bind to `127.0.0.1` only. If one is already taken (for example by a native Postgres), copy `.env.example` to `.env` and change it there.

Data lives in named Docker volumes, so it survives `pnpm infra:down`. Use `pnpm infra:reset` to delete it and start clean.

The compose file has two placeholder profiles that later milestones fill in: `full` runs the app itself in containers, and `observability` adds Prometheus and Grafana.

## Scripts

| Command                 | What it does                                                |
| ----------------------- | ----------------------------------------------------------- |
| `pnpm dev`              | Runs the API and the web app in watch mode                  |
| `pnpm build`            | Builds every package (Turborepo, cached)                    |
| `pnpm typecheck`        | Type-checks every package with `tsc --noEmit`               |
| `pnpm lint`             | Lints every package with ESLint                             |
| `pnpm test`             | Runs unit tests with Vitest                                 |
| `pnpm test:integration` | Runs API integration tests (needs Docker, or `TEST_*` URLs) |
| `pnpm db:deploy`        | Applies database migrations                                 |
| `pnpm db:migrate`       | Creates and applies a migration (development)               |
| `pnpm format`           | Formats the repo with Prettier                              |
| `pnpm format:check`     | Checks formatting without writing                           |
| `pnpm clean`            | Removes build output and Turborepo caches                   |
| `pnpm infra:up`         | Starts local infra and waits until healthy                  |
| `pnpm infra:check`      | Smoke-tests the running local infra                         |
| `pnpm infra:down`       | Stops local infra, keeping its data                         |
| `pnpm infra:reset`      | Stops local infra and deletes its data                      |

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
| M6 Ship v1.0                   | Docker images, observability dashboards and a hosted demo                     |

## License

[MIT](LICENSE)
