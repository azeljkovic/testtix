# TestTix

A sample event ticket shop — concerts, talks and meetups — built as a realistic target for software testing practice.

Ticket sales naturally produce the failure modes worth practising on: race conditions on the last seat, time-dependent seat holds, ticket drops with a waiting room, asynchronous checkout with emailed tickets, and a seat map that is hard to make accessible.

> **Status:** early development. The app is being built in small, verifiable chunks (see [Roadmap](#roadmap)).

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

Requirements: Node.js 24 (see `.nvmrc`) and pnpm 10 (via [Corepack](https://nodejs.org/api/corepack.html)).

```sh
nvm use            # or install Node 24 another way
corepack enable    # provides the pnpm version pinned in package.json
pnpm install
pnpm build
```

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `pnpm build`        | Builds every package (Turborepo, cached)      |
| `pnpm typecheck`    | Type-checks every package with `tsc --noEmit` |
| `pnpm lint`         | Lints every package with ESLint               |
| `pnpm format`       | Formats the repo with Prettier                |
| `pnpm format:check` | Checks formatting without writing             |
| `pnpm clean`        | Removes build output and Turborepo caches     |

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
