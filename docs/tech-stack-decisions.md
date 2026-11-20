# TestTix — Tech stack decisions

Status: draft v2 (2026-11-17), updated for C0.6 (2026-11-20)
Legend: **[Decided]** = chosen by Aleksandar · **[Proposed]** = default pick, open to change

---

## 1. Repository and tooling

| Area            | Decision                                                      | Status   |
| --------------- | ------------------------------------------------------------- | -------- |
| Repo shape      | Monorepo with the whole app                                   | Decided  |
| Package manager | pnpm workspaces                                               | Proposed |
| Task runner     | Turborepo (build/test/lint caching)                           | Proposed |
| Language        | TypeScript everywhere, `strict: true`                         | Proposed |
| Runtime         | Node.js current LTS (24.x), pinned via `.nvmrc` and `engines` | Proposed |
| Lint / format   | ESLint (flat config) + Prettier                               | Proposed |
| Licence         | MIT (public practice app)                                     | Proposed |

**Layout**

```
apps/
  web/             React frontend
  api/             NestJS backend
  fake-payments/   fake payment provider (separate service)
packages/
  shared/          Zod schemas, shared types, constants
  config/          shared tsconfig, ESLint, Prettier configs
docker/            compose files, Dockerfiles
```

**Test split [Decided]**

- **This repo:** tests tightly coupled to code: unit, component and API integration tests.
- **Separate repo:** UI e2e, API e2e, performance (k6). It treats TestTix as a black box and runs against published Docker images or the hosted demo.

---

## 2. Frontend (`apps/web`)

| Area         | Decision                                                                                                                            | Status   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Framework    | React                                                                                                                               | Decided  |
| Build        | Vite SPA (clean frontend/backend split, no SSR)                                                                                     | Proposed |
| Routing      | React Router                                                                                                                        | Proposed |
| Server state | TanStack Query                                                                                                                      | Proposed |
| Forms        | React Hook Form + Zod resolver (schemas from `packages/shared`)                                                                     | Proposed |
| API client   | `openapi-typescript` + `openapi-fetch`, generated from the API's OpenAPI spec                                                       | Proposed |
| Styling      | Tailwind CSS                                                                                                                        | Proposed |
| Components   | React Aria Components for general accessible primitives; **seat map hand-built** so its accessibility issues are fully controllable | Proposed |

Notes:

- Search input is debounced (fixed, documented delay) on purpose to support the debounced-search demo.
- All interactive elements get stable accessible names. `data-testid` is used only where no good accessible locator exists, so locator strategy stays a meaningful exercise.

**Versions and notes (C0.6)**

- **React 19, React Router 8, Vite 8, Tailwind CSS 4** (via `@tailwindcss/vite`, no `tailwind.config`), TanStack Query 5, React Aria Components 1.x. React Router is used in data mode (`createBrowserRouter` with a shared route table), not framework mode, since the app is a plain SPA.
- **Document titles** use React 19's built-in `<title>` hoisting (`PageTitle`), no helmet library.
- **React Aria + React Router:** `RootLayout` wraps the app in React Aria's `RouterProvider`, so React Aria links and menus navigate client-side.
- **API calls** go to `/api/*` on the page's own origin. The Vite dev server proxies them to the API and strips the prefix; production gets the same rule from Caddy (C6.1). This avoids CORS entirely. Until C0.7 the one call (`GET /health`) uses `fetch` directly.
- **Lint:** the shared ESLint config gains a `react` option with `eslint-plugin-react-hooks` (recommended rules, including the React Compiler checks). `eslint-plugin-jsx-a11y` is left out because it doesn't support ESLint 10 yet; axe checks in component tests cover accessibility.
- **Component tests:** Vitest with jsdom, React Testing Library and user-event. MSW 3 answers API calls (`onUnhandledFrame: 'error'`, so an unmocked request fails the test). `vitest-axe` 0.1 still declares its matcher types for an old Vitest, so `src/testing/axe.ts` re-declares `toHaveNoViolations` for Vitest's `Matchers` interface; jsdom can't measure colour contrast, so that axe rule is off in component tests and left to e2e.

---

## 3. Backend (`apps/api`)

| Area       | Decision                                                                                                              | Status   |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Framework  | NestJS                                                                                                                | Decided  |
| HTTP layer | Fastify (`@nestjs/platform-fastify`), not Express                                                                     | Proposed |
| API style  | REST + OpenAPI 3 (served at `/docs` and `/openapi.json`)                                                              | Proposed |
| Validation | Zod via `nestjs-zod`, with schemas shared with the frontend, as the single source of truth for validation and OpenAPI | Proposed |
| Logging    | `nestjs-pino` (structured JSON logs with request IDs)                                                                 | Proposed |
| Metrics    | Prometheus endpoint `/metrics` (`@prometheus-io/client`, the successor of the deprecated `prom-client`)               | Proposed |
| Modules    | ESM (`"type": "module"`, `NodeNext`), compiled by `tsc`; Vitest uses `unplugin-swc` for decorator metadata            | Proposed |
| Errors     | `application/problem+json` (RFC 9457) for every error, plus `requestId` and `errors[]`; see `docs/testing-guide.md`   | Proposed |

**Versions and notes (C0.4)**

- **NestJS 11, not 12.** `nestjs-zod` 5.x declares `@nestjs/common` `^10 || ^11` as its peer range, and Nest 11 is still maintained. Upgrade to 12 once `nestjs-zod` supports it (same rule as the TypeScript pin).
- **ESM works with Nest.** No friction in C0.4: `tsc` output runs on Node directly, and `nestjs-zod`, `nestjs-pino` and `@nestjs/swagger` load as ESM or CJS without issues. Nest's DI needs `experimentalDecorators` + `emitDecoratorMetadata`, which `tsc` and SWC support (esbuild and oxc don't, hence SWC in Vitest).
- **Readiness** checks Postgres through Prisma (`SELECT 1`, since C0.5) and Redis with `ioredis`, which stays as the Redis client for BullMQ (C3.2).
- **Fastify instead of Express** (changed during C0.4 review): faster under the ticket-drop load the k6 tests will apply, and its request lifecycle gives every request an ID before body parsing. Nest-level code (controllers, filters, guards, `nestjs-zod`, `nestjs-pino`) is adapter-independent; only code that touches the raw request or reply uses Fastify types. Swagger UI on Fastify needs `@fastify/static`.
- **Request IDs** come from Fastify's `genReqId`: a well-formed incoming `X-Request-Id` is reused, anything else is replaced with a UUID. An `onRequest` hook echoes it in the response header, and pino-http logs the same ID, so even a request rejected for malformed JSON has one.

### 3.1 Database

| Area       | Decision                                                                           | Status   |
| ---------- | ---------------------------------------------------------------------------------- | -------- |
| Database   | PostgreSQL                                                                         | Decided  |
| ORM        | Prisma                                                                             | Decided  |
| Migrations | `prisma migrate`                                                                   | Proposed |
| Seed data  | Deterministic seed script (Faker with a fixed seed) and a few named fixture events | Proposed |

**Versions and notes (C0.5)**

- **Prisma 7, not 8.** npm's `latest` tag for `prisma` points at an 8.0 release candidate; v1 uses the newest stable release (7.10.x). Upgrade once 8 is stable.
- **Prisma 7 setup:** the `prisma-client` generator writes TypeScript into `apps/api/src/generated/prisma` (git-ignored, ESM, `.js` import extensions), which `tsc` compiles with the rest of the API. Turbo's `generate` task runs `prisma generate` before build, typecheck, lint and tests. The connection URL lives in `apps/api/prisma.config.ts` (Prisma 7 no longer puts it in the schema or reads `.env` itself, so the config loads the root `.env`).
- **Driver adapter:** Prisma 7 has no built-in query engine; `PrismaService` connects through `@prisma/adapter-pg` (node-postgres). The pool connects lazily, so the API still starts while Postgres is down.
- **Naming:** models are PascalCase/camelCase in Prisma and snake_case in Postgres (`@@map` / `@map`), e.g. `User` → `users`. Primary keys are UUIDv7 (`@default(uuid(7)) @db.Uuid`).
- **pnpm build scripts:** `prisma` and `@prisma/engines` are allowed to run install scripts (`onlyBuiltDependencies`), so the migration engine is downloaded at install time.

**Concurrency for "buying the last seat"**

- Seat claims use an atomic conditional update inside a Prisma interactive transaction, e.g. `UPDATE seat SET status='HELD', held_by=…, held_until=… WHERE id=… AND status='AVAILABLE'`. If 0 rows were affected, the seat is already taken and the API returns 409.
- Order creation re-validates the hold in the same transaction.
- Later (not v1): a bug toggle `RACE_CONDITION_LAST_SEAT` switches to a naive read-then-write path so the race is reproducible.

### 3.2 Seat holds and time

- Holds live in Postgres (`held_until` on the seat/hold row). A hold counts as expired when `held_until < clock.now()`, evaluated lazily on every read and write.
- A BullMQ repeatable job sweeps expired holds for cleanup only. Correctness never depends on the sweeper.
- **Injectable `ClockService`:** all server-side "now" goes through it. In test mode the clock can be frozen, set or advanced through the test API, so hold expiry is testable server-side and not just in the browser (Playwright's clock only covers the browser).
- Default hold duration is 10 minutes, configurable per event.

### 3.3 Background jobs

| Area  | Decision                                                                                       | Status   |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| Queue | BullMQ on Redis (`@nestjs/bullmq`)                                                             | Proposed |
| Jobs  | payment confirmation handling, ticket generation + email, hold sweeper, waiting-room admission | Proposed |

Order lifecycle: `PENDING_PAYMENT → PROCESSING → CONFIRMED | FAILED | EXPIRED`. Job processing delay is configurable so the "data appears eventually" scenario can be tuned.

### 3.4 Waiting room (ticket drops)

- Redis sorted set per drop. Users get a queue token and are admitted at a configurable rate (N per second).
- Admitted users get a short-lived admission token that is required to reach the seat map for that event.
- Admin can schedule a drop (`sales_open_at`) and set the admission rate.

### 3.5 Real-time updates

- **Polling for v1**, for queue position and order status: `GET` endpoints with a `retryAfterMs` hint. It is the most testable option and fits the "polling vs. fixed waits" demo.
- SSE may be added later as a second exercise.

### 3.6 Payments (`apps/fake-payments`)

- A small separate service that imitates a hosted payment provider: a redirect to a payment page, then an asynchronous webhook back to the API.
- Behaviour is driven by test card numbers (like Stripe's test cards): success, decline, insufficient funds, timeout/no webhook, delayed webhook, duplicate webhook.
- Webhooks are signed (HMAC), so the API verifies signatures and handles them idempotently.
- Real providers are out of scope. This keeps payment behaviour deterministic, with no external dependency.

### 3.7 Email

- Nodemailer over SMTP, sent to **Mailpit** locally and in the demo environment.
- Emails: account verification, order confirmation, e-ticket.
- **E-ticket [Decided]:** QR code in the email body **and** a PDF ticket attachment (one page per ticket, with QR, event, seat and order ID). QR via `qrcode`, PDF via `pdfkit`.
- Templates use Handlebars, with plain-text and HTML parts.

### 3.8 Auth and roles

| Area          | Decision                                                                                                           | Status   |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Login         | Email + password, hashed with argon2                                                                               | Proposed |
| Session       | HttpOnly, SameSite=Lax session cookie; sessions stored in Postgres                                                 | Proposed |
| Roles         | `CUSTOMER`, `ADMIN` (guards via Nest decorators)                                                                   | Proposed |
| CSRF          | Double-submit token for state-changing requests                                                                    | Proposed |
| Test shortcut | In test mode: `POST /__test/sessions` creates a user with a role and returns a session cookie, for API-based setup | Proposed |

---

## 4. Testability features

Enabled when `TESTTIX_TEST_MODE=true`.

**Hosted demo [Decided]: test API enabled in v1.** The public demo runs with test mode on.

**Access on the hosted demo [Proposed]:** the demo is shared, so `reset` and `clock` affect every user at once (one person freezing time or wiping data breaks everyone else's session). For that reason:

- `POST /__test/reset` and `POST /__test/clock` require a secret `X-Test-Key` header on the hosted demo. They stay open locally.
- `POST /__test/seed/{scenario}` and `POST /__test/sessions` stay open to everyone. They only _add_ data, so they're safe on a shared instance.
- Test API calls are rate limited separately and logged.

**Test API (`/__test/*`)**

- `POST /__test/reset`: truncate and reseed (deterministic).
- `POST /__test/seed/{scenario}`: load named scenarios, e.g. `sold-out-event`, `one-seat-left`, `drop-in-5-min`.
- `POST /__test/clock` with `{ freezeAt | advanceBy | reset }`.
- `POST /__test/sessions`: see Auth.

**Intentional bugs [Decided]: none in v1.** The first version ships bug-free. Bug toggles (with a `GET/PUT /__test/bugs` endpoint) or versioned buggy deployments come in a later version. Candidate bugs for that version:

- `RACE_CONDITION_LAST_SEAT`: no atomic seat claim.
- `NONDETERMINISTIC_EVENT_ORDER`: no tiebreaker in event list sort.
- `HOLD_TIMER_CLIENT_ONLY`: server does not enforce hold expiry.
- `DUPLICATE_WEBHOOK_DOUBLE_CHARGE`: webhook handler is not idempotent.
- `SEAT_MAP_A11Y_BROKEN`: colour-only seat states, missing labels, no keyboard nav.
- `PAGINATION_OFF_BY_ONE`.

**Data isolation**

- Every test can create its own events and ticket batches through the admin API, so tests don't share mutable fixtures.
- Default sort orders always have a stable tiebreaker.

---

## 5. In-repo tests

| Layer                            | Tooling                                                                 | Status   |
| -------------------------------- | ----------------------------------------------------------------------- | -------- |
| Unit (web + api)                 | Vitest (with `unplugin-swc` for Nest decorators)                        | Proposed |
| Component (web)                  | Vitest + React Testing Library + MSW                                    | Proposed |
| API integration                  | Vitest + Supertest against a real Postgres and Redis via Testcontainers | Proposed |
| Accessibility smoke (components) | `vitest-axe`                                                            | Proposed |

**Integration harness (C0.5)**

- Unit and integration tests are two Vitest projects in `apps/api/vitest.config.ts`. Integration test files are named `*.int.test.ts`; `pnpm test` runs unit tests only, `pnpm test:integration` runs the integration ones.
- The global setup uses `TEST_DATABASE_URL` / `TEST_REDIS_URL` when set and starts a Testcontainers container for each one that isn't, with the image tags read from `docker/compose.yml`. It then runs `prisma migrate deploy`.
- Before each test file, every table except `_prisma_migrations` is truncated and the Redis database is flushed. Files therefore run one at a time (`fileParallelism: false`). If that gets slow, the next step is one database per Vitest worker.
- Because the data is wiped, the harness refuses a `TEST_DATABASE_URL` whose database isn't named `test` or `*_test`, and a `TEST_REDIS_URL` that selects Redis database 0.
- Tests boot the real app with `createIntegrationApp()` and call it with Supertest. CI runs the integration job after lint, typecheck and unit tests, with Testcontainers.

The OpenAPI spec is published as a CI artifact and with each release, so the external test repo can generate clients or contract checks.

---

## 6. Running, hosting, CI

| Area               | Decision                                                                                                                                                                                                   | Status   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Local dev          | Docker Compose: postgres, redis, mailpit, fake-payments; api and web run via `pnpm dev`, or fully containerised with the `full` profile                                                                    | Proposed |
| Observability      | Optional compose profile `observability`: Prometheus + Grafana with a "ticket drop" dashboard for k6 runs                                                                                                  | Proposed |
| Images             | Multi-stage Dockerfiles; images pushed to GHCR, tagged by semver and commit SHA                                                                                                                            | Proposed |
| Hosted demo        | Single VPS (e.g. Hetzner) running Docker Compose behind Caddy (automatic TLS); nightly data reset                                                                                                          | Proposed |
| Performance runs   | **Both** local/compose and the hosted demo                                                                                                                                                                 | Decided  |
| Hosted demo sizing | VPS sized for ticket-drop scenarios (start at ~4 vCPU / 8 GB, adjust from first k6 baselines); API horizontally scalable within compose (`api` replicas behind Caddy)                                      | Proposed |
| Rate limiting      | `@nestjs/throttler` with Redis storage; limits configurable via env. Authorised load runs send a secret `X-Load-Test-Key` header that lifts limits, so the public demo stays protected from anonymous load | Proposed |
| Load-run hygiene   | Hosted load runs use dedicated seeded events and are followed by `POST /__test/reset`; run them outside peak hours                                                                                         | Proposed |
| CI                 | GitHub Actions: lint → typecheck → unit → integration → build images → push on `main`/tags                                                                                                                 | Proposed |
| Cross-repo         | On release, send a `repository_dispatch` to the tests repo to run e2e against the new image tag                                                                                                            | Proposed |
| Versioning         | Semver git tags; changelog per release                                                                                                                                                                     | Proposed |

---

## 7. Resolved questions

| Question                                                        | Answer                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Do performance runs use the hosted demo or only local/compose?  | Both, see §6 (sizing, rate limiting, load-run hygiene)                              |
| Bug toggles on the public demo, or versioned buggy deployments? | First version ships without intentional bugs; the bug mechanism is deferred, see §4 |
| Ticket delivery: QR in email body only, or also a PDF?          | QR in body and a PDF attachment, see §3.7                                           |
| Is the test API enabled on the public hosted demo?              | Yes, in v1; global-effect endpoints behind a key, see §4                            |
