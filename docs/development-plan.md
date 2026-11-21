# TestTix — Development plan

Status: draft v2 (2026-11-17) · Based on `Idea` and `claude/tech-stack-decisions.md` (draft v2)

**Repo:** https://github.com/azeljkovic/testtix (public, commits as `azeljkovic`) · **Local folder:** `/Users/aleksandar/code/aleksandar/testtix`
**v1 scope:** seated **and** general-admission (GA) events, USD, English UI.

## How to use this plan

- Work is split into **chunks**. Each chunk is one branch → one PR → merged to `main`. It is small enough to finish, push, test and verify in one session.
- Chunks are grouped into **milestones**. Each milestone ends with something you can demo.
- IDs (`C0.1`, `C3.2`…) are stable. Reference them in branch names (`c3-1-seat-holds-api`), PR titles and commits.
- Order inside a milestone follows the `Depends on` column. Chunks with no dependency on each other can be done in any order.

### Definition of done (every chunk)

1. CI green: lint → typecheck → unit → integration (once that stage exists).
2. New behaviour has tests at the lowest layer that proves it (unit < component < API integration).
3. If the API changed, `openapi.json` and the generated web client are regenerated. CI fails if they are stale (from C0.7).
4. New env vars are added to `.env.example` and to the Zod config schema.
5. Docs are updated where testers will look: README, `docs/testing-guide.md` (test API, seed scenarios, test cards, clock).
6. The PR description lists **verification steps** (commands, curl calls, URLs) and their results.

### Verification note for Claude's workspace

Claude's workspace has no Docker daemon, so Testcontainers can't run there. Because of that:

- The integration harness accepts `TEST_DATABASE_URL` / `TEST_REDIS_URL` / `TEST_SMTP_*` and only starts Testcontainers when they're missing. CI uses GitHub Actions service containers or Testcontainers. Claude uses natively installed Postgres/Redis where possible.
- When a chunk's integration tests can't run in the workspace, **CI is the source of truth**: Claude pushes, watches the run with `gh run watch`, and fixes until it's green.
- UI checks: Claude runs `pnpm dev` and checks pages in the browser preview, if one is available.

---

## Milestones at a glance

| Milestone                          | Chunks    | Demo at the end                                                                              |
| ---------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| **M0 Foundation**                  | C0.1–C0.7 | Empty app shell; API with `/health`, `/docs`; CI green; typed client pipeline                |
| **M1 Accounts & testability core** | C1.1–C1.6 | Register, verify email (Mailpit), log in; test API resets, seeds and controls the clock      |
| **M2 Catalogue**                   | C2.1–C2.4 | Admin creates events and releases batches; customers browse, filter, search, paginate        |
| **M3 Seats & holds**               | C3.1–C3.4 | Accessible seat map; hold with countdown; last-seat conflict returns 409                     |
| **M4 Checkout & tickets**          | C4.1–C4.5 | Pay through fake provider; order goes processing → confirmed; e-ticket (QR + PDF) in Mailpit |
| **M5 Ticket drops**                | C5.1–C5.4 | Scheduled drop with waiting room; rate limits; drop scenarios seeded                         |
| **M6 Ship v1.0**                   | C6.1–C6.5 | Images on GHCR, observability profile, hosted demo, v1.0 release triggering the tests repo   |

---

## M0 — Foundation

| ID   | Chunk                                    | Depends on |
| ---- | ---------------------------------------- | ---------- |
| C0.1 | Monorepo scaffold                        | —          |
| C0.2 | CI skeleton                              | C0.1       |
| C0.3 | Local infra (Docker Compose)             | C0.1       |
| C0.4 | API skeleton                             | C0.1       |
| C0.5 | Prisma + integration test harness        | C0.3, C0.4 |
| C0.6 | Web skeleton + test setup                | C0.1       |
| C0.7 | Shared schemas + OpenAPI client pipeline | C0.4, C0.6 |

**C0.1 Monorepo scaffold**

- pnpm workspaces, Turborepo, `apps/{web,api,fake-payments}` and `packages/{shared,config}` as empty, buildable placeholders.
- `packages/config`: shared tsconfig (`strict`), ESLint flat config, Prettier.
- `.nvmrc` + `engines` (Node 24 LTS), MIT LICENSE, README with quick start, `.editorconfig`, `.gitignore`.
- Verify: `pnpm install && pnpm lint && pnpm typecheck && pnpm build` pass from a clean clone.

**C0.2 CI skeleton**

- GitHub Actions on PR and `main`: install (pnpm cache) → lint → typecheck → unit (Vitest with a placeholder test). Turbo cache.
- Verify: a PR shows a green check, and a deliberately broken lint rule fails it.

**C0.3 Local infra**

- `docker/compose.yml`: postgres, redis, mailpit, with health checks and named volumes. Placeholder profiles `full` and `observability`.
- `pnpm infra:up` / `infra:down` scripts. `.env.example`.
- Verify: `docker compose up -d` makes all services healthy, and the Mailpit UI is reachable.

**C0.4 API skeleton**

- NestJS app, `nestjs-pino` with request IDs, Zod-validated config module (fails fast on bad env).
- `nestjs-zod` wired. OpenAPI at `/docs` and `/openapi.json`.
- `GET /health` (liveness) and `GET /health/ready` (checks db and redis), `/metrics` (`@prometheus-io/client` defaults; `prom-client` is deprecated in its favour).
- Global error format (problem+json style: `type`, `title`, `status`, `detail`, `errors[]`).
- Vitest + `unplugin-swc` set up, unit test for the config schema.
- Verify: `curl /health` returns 200, `/docs` renders, logs are JSON with a request ID.

**C0.5 Prisma + integration harness**

- Prisma set up with an initial migration (minimal `User` table, enough to prove the pipeline).
- Integration test project: global setup starts Postgres and Redis (Testcontainers, or the `TEST_*` URLs), runs `prisma migrate deploy`, boots the Nest app for Supertest, truncates between test files.
- CI: an integration stage is added.
- Verify: an integration test hits `/health/ready` against real Postgres and Redis, and passes in CI.

**C0.6 Web skeleton**

- Vite + React + React Router + TanStack Query + Tailwind + React Aria Components.
- App shell: header, nav, footer, 404 page, a skip-to-content link, document titles per route.
- Vitest + React Testing Library + MSW + `vitest-axe`, with one component test and one axe test.
- Vite dev proxy `/api` → API.
- Verify: `pnpm dev` renders the shell, and the tests and axe check pass.

**C0.7 Shared schemas + client pipeline**

- `packages/shared`: Zod schemas, enums and constants (order statuses, roles, error codes).
- Script: build the API → export `openapi.json` → `openapi-typescript` → typed `openapi-fetch` client in `apps/web`.
- CI: regenerate, then `git diff --exit-code` (fails on a stale spec). Upload `openapi.json` as a CI artifact.
- Verify: changing a response schema without regenerating fails CI.

---

## M1 — Accounts & testability core

| ID   | Chunk                                  | Depends on       |
| ---- | -------------------------------------- | ---------------- |
| C1.1 | Test mode + ClockService               | C0.5             |
| C1.2 | Domain data model + deterministic seed | C0.5             |
| C1.3 | Test API: reset, seed scenarios        | C1.1, C1.2       |
| C1.4 | Auth API (sessions, roles, CSRF)       | C1.2             |
| C1.5 | Mailer + account verification email    | C1.4             |
| C1.6 | Web auth pages                         | C1.4, C1.5, C0.7 |

**C1.1 Test mode + ClockService**

- `TESTTIX_TEST_MODE` gates a `TestModule`. When it's off, `/__test/*` returns 404 and the module isn't loaded.
- `ClockService` is the only source of server "now". Its state (frozen at / offset) lives in **Redis**, so all API replicas and workers see the same time.
- `POST /__test/clock` with `{ freezeAt | advanceBy | reset }` and `GET /__test/clock`.
- `X-Test-Key` guard for global-effect endpoints, enabled when `TEST_API_KEY` is set (hosted demo). Endpoints stay open when it's unset (local).
- Lint rule (or a unit check) that bans `new Date()` / `Date.now()` in `apps/api/src` outside `ClockService`.
- Verify: integration tests for freeze, advance, reset, a 404 with test mode off, and a 401 without the key when the key is configured.

**C1.2 Domain data model + seed**

- Prisma models: `User`, `Session`, `Venue`, `Section` (type `SEATED` or `GA`; GA has a capacity), `Seat` (venue layout, seated sections only), `Event` (category: concert / talk / meetup; status: draft / published / cancelled; `salesOpenAt`, `holdDurationSec`, `maxTicketsPerOrder`, drop settings), `InventoryUnit` (one sellable ticket for an event: `sectionId`, nullable `seatId` (null for GA), `status`, `priceCents`, `holdId`, `heldUntil`, `batchId`), `Hold` (one per user and event; added in C1.2, see tech-stack §3.1), `TicketBatch`, `Order`, `OrderItem`, `Ticket`, `PaymentEvent` (webhook idempotency).
- Seated and GA inventory share one model, so holds, expiry, orders and tickets use one code path. An event can mix both, e.g. a festival stage with seated stands and a GA standing area.
- Money is stored as integer cents, currency USD (constant in `shared`).
- Indexes for list queries and inventory lookups. Every list sort has a unique tiebreaker (`id`).
- Seed: Faker with a fixed seed, plus named fixture venues and events (stable slugs and IDs).
- Verify: running the seed twice produces an identical data hash (tested), and `prisma migrate reset` works (Prisma 7 no longer seeds on reset: `pnpm db:reset && pnpm db:seed`).

**C1.3 Test API: reset and scenarios**

- `POST /__test/reset`: truncates everything, reseeds deterministically, resets the clock. Key-guarded when a key is configured.
- `POST /__test/seed/{scenario}` is additive and returns the created IDs. Starting scenarios: `basic-catalogue`, `sold-out-event`, `one-seat-left`. Later chunks add more.
- Separate rate limit and logging for `/__test/*` are deferred to C5.3. A TODO points there.
- Verify: integration tests show reset restores the baseline and each scenario returns usable IDs.

**C1.4 Auth API**

- `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me`. argon2 hashing.
- Sessions in Postgres, HttpOnly SameSite=Lax cookie, sliding expiry through `ClockService`.
- CSRF double-submit (`GET /auth/csrf` or a cookie, plus a header on state-changing requests).
- `@Roles()` decorator + guards for `CUSTOMER` and `ADMIN`.
- `POST /__test/sessions` `{ role, email? }` → creates the user and returns a session cookie and CSRF token.
- Verify: integration tests for wrong password, duplicate email, an expired session (advance the clock), a missing CSRF token returning 403, and customer vs admin guard checks.

**C1.5 Mailer + verification email**

- Nodemailer SMTP → Mailpit. Handlebars templates with HTML and text parts, plus a shared layout.
- Verification token on register; `POST /auth/verify-email`; resend endpoint. Unverified users can log in but can't check out (enforced in C4.2).
- Mailpit added to the integration harness. A test helper queries the Mailpit API (`waitForEmail(to, subject)` with polling).
- Verify: an integration test registers, reads the email from Mailpit, follows the token, and sees the user verified.

**C1.6 Web auth pages**

- Register, log in, log out, verify-email landing, resend verification, and an account menu.
- Forms use React Hook Form + Zod resolver with schemas from `shared`. Server field errors map to fields.
- Route guards for logged-in and admin routes. A session query is used across the app.
- Verify: component tests (MSW) for validation and error states, an axe check on each form, and a manual run against the real API.

**M1 demo:** register in the UI → email arrives in Mailpit → verify → log in. `POST /__test/reset` and the clock endpoints work.

---

## M2 — Catalogue

| ID   | Chunk                             | Depends on |
| ---- | --------------------------------- | ---------- |
| C2.1 | Admin events + ticket batches API | C1.4       |
| C2.2 | Public catalogue API              | C1.2       |
| C2.3 | Web: event list + detail          | C2.2, C0.7 |
| C2.4 | Web: admin area                   | C2.1, C1.6 |

**C2.1 Admin events API**

- CRUD for venues (with a section/row/seat layout generator for seated sections and a capacity for GA sections) and events. Actions: publish, unpublish, cancel.
- `POST /admin/events/:id/batches`: releases inventory at a price, optionally scheduled. Seated: by section or a seat ID list. GA: a quantity per GA section. Unreleased inventory isn't sellable.
- Validation: a published event needs at least one released batch; you can't edit layout after sales.
- Verify: integration tests for role checks (customer gets 403, anonymous gets 401), full lifecycle and validation errors. This is also the **API-based data setup** path the external test repo will use, so it gets documented in the testing guide.

**C2.2 Public catalogue API**

- `GET /events` with filters (category, date range, venue, availability), `q` search (title and performer, case-insensitive), sort (date / price / name) with an `id` tiebreaker, page-based pagination (`page`, `pageSize`, `total`, `totalPages`).
- `GET /events/:slug` with an availability summary (available / held / sold per section, seated or GA, price range).
- Filter `seating=seated|ga|mixed`.
- Published events only.
- Verify: integration tests for every filter, pagination boundaries (first, last, beyond last, page size of 1), stable order on equal dates, and an empty result.

**C2.3 Web: event list + detail**

- List page: filters, a debounced search (fixed **300 ms**, defined as a constant in `shared` and documented), pagination. All state lives in the URL query (shareable, back button works).
- Loading skeletons, empty and error states. Detail page with an availability summary and a "Choose seats" call to action.
- Verify: component tests for the debounce (fake timers), URL sync and pagination controls, plus axe checks.

**C2.4 Web: admin area**

- Admin-only routes: event list (including drafts), create/edit event (seated, GA or mixed sections), release a batch, publish or cancel.
- Verify: component tests and a manual flow where admin creates and publishes an event that then appears in the public list.

**M2 demo:** admin creates and publishes an event; a customer finds it through filters and search.

---

## M3 — Seats & holds

| ID   | Chunk                         | Depends on |
| ---- | ----------------------------- | ---------- |
| C3.1 | Seat map + holds API (atomic) | C2.1, C1.1 |
| C3.2 | BullMQ setup + hold sweeper   | C3.1       |
| C3.3 | Web: accessible seat map      | C3.1, C2.3 |
| C3.4 | Web: hold flow + countdown    | C3.3       |

**C3.1 Seat map + holds API**

- `GET /events/:id/seats`: layout plus per-seat status for seated sections, and an available count per GA section. Expiry is evaluated lazily (`heldUntil < clock.now()` counts as available).
- `POST /events/:id/holds` `{ seats: [seatId], ga: [{ sectionId, quantity }] }`: all-or-nothing inside one interactive transaction.
  - Seated: atomic conditional update per seat (`WHERE status = 'AVAILABLE'` or expired). Any seat lost → 409 with the conflicting seat IDs.
  - GA: claim N units with `SELECT … FOR UPDATE SKIP LOCKED LIMIT n`, then a conditional update. Fewer than N available → 409 with the remaining count.
  - Max tickets per hold (default 6, configurable per event). One active hold per user per event; a new hold replaces the old one.
- `GET /holds/current`, `DELETE /holds/:id`.
- Scenarios: `one-seat-left` is extended; `hold-about-to-expire`, `ga-meetup` and `ga-last-ticket` are added.
- Verify: integration tests, including **concurrency tests**: 20 parallel requests for the last seat produce exactly one 201 and nineteen 409s, and 20 parallel requests for the last 3 GA tickets (1 each) produce exactly three 201s; both run 10 times. Also: hold expiry through `advanceBy`, the max-tickets limit, holding a sold seat, and a mixed seated + GA hold rolling back fully when one part fails.

**C3.2 BullMQ + hold sweeper**

- `@nestjs/bullmq` setup. A worker runs in the same process by default, or as a separate `worker` entrypoint via env, so it can scale on its own.
- Repeatable sweeper job clears expired holds (cleanup only).
- Verify: an integration test with the sweeper disabled shows expired seats are still available (correctness doesn't depend on the sweeper); with it enabled, rows are cleaned after `advanceBy`.

**C3.3 Web: accessible seat map**

- Hand-built seat map. Rows and sections are labelled. Grid semantics with roving tabindex and arrow-key navigation; Enter or Space toggles a seat.
- Each seat has an accessible name, e.g. "Section A, row B, seat 12, €45, available".
- Seat states are shown by shape or icon **and** colour, never colour alone. There's a legend and a live region that announces selection changes.
- GA sections get an accessible quantity stepper (labelled, min/max announced, shows remaining count) instead of a seat grid. Mixed events show both.
- A selection summary shows seats, GA quantities and a running total in USD.
- Verify: component tests for keyboard navigation, selection and the GA stepper limits, axe checks with zero violations, and a manual screen-reader pass noted in the PR.

**C3.4 Web: hold flow + countdown**

- "Hold seats" button. A 409 shows which seats were taken and refreshes the map.
- Countdown is derived from server `heldUntil` and the browser clock (`Date.now()` only, no extra timers), so Playwright's clock control works.
- On expiry: a banner, the selection clears, and the map refreshes. Release-hold button.
- Verify: component tests with fake timers cover the countdown and expiry, and the conflict path is tested with MSW.

**M3 demo:** select seats with the keyboard (or a GA quantity), hold them, watch the countdown; a second browser trying the same seat or the last GA ticket gets a clear conflict.

---

## M4 — Checkout & tickets

| ID   | Chunk                                    | Depends on      |
| ---- | ---------------------------------------- | --------------- |
| C4.1 | Fake payments service                    | C0.4            |
| C4.2 | Orders API                               | C3.1, C4.1      |
| C4.3 | Webhook handling + order processing jobs | C4.2, C3.2      |
| C4.4 | Ticket generation + e-ticket email       | C4.3, C1.5      |
| C4.5 | Web: checkout, order status, my tickets  | C4.2–C4.4, C3.4 |

**C4.1 Fake payments service**

- `apps/fake-payments`: a small NestJS app, for consistent tooling.
- `POST /sessions` (amount, currency, `returnUrl`, `webhookUrl`, metadata) → payment page URL. The server-rendered payment page has a card form and an accessible layout.
- Test cards (documented): success, decline, insufficient funds, no webhook, delayed webhook (configurable), duplicate webhook.
- Webhooks are signed with HMAC-SHA256 plus a timestamp header (replay window) and retried on non-2xx with backoff.
- Added to compose. Its own unit and integration tests use a webhook receiver stub.
- Verify: tests cover each card's behaviour and that signatures verify with the shared secret.

**C4.2 Orders API**

- `POST /orders` `{ holdId }`: re-validates the hold in the same transaction, requires a verified email, creates `PENDING_PAYMENT`, creates a payment session, and returns `paymentUrl`.
- `GET /orders/:id` returns status, items and `retryAfterMs`. `GET /orders` lists my orders, paginated.
- An unpaid order becomes `EXPIRED` when its hold expires (evaluated lazily, plus a sweep).
- Verify: integration tests for an expired hold, someone else's hold, an unverified user, and expiry via the clock.

**C4.3 Webhook handling + processing**

- `POST /webhooks/payments`: signature and timestamp check (400 on failure), idempotent on the provider event ID (`PaymentEvent` unique), enqueues a job.
- Job: `PROCESSING` → `CONFIRMED` (seats become SOLD) or `FAILED` (seats released). `JOB_PROCESSING_DELAY_MS` is configurable.
- A late success webhook for an `EXPIRED` order is recorded and flagged for refund, never sold. This rule is documented.
- Verify: integration tests where a duplicate webhook causes one transition, a bad signature returns 400, out-of-order webhooks are handled, and an end-to-end run with the real fake-payments container works.

**C4.4 Tickets + e-ticket email**

- On confirm: one ticket per inventory unit with a unique, unguessable code.
- QR via `qrcode` and PDF via `pdfkit` (one page per ticket with QR, event, seat or "General admission – {section}", and order ID).
- Order confirmation and e-ticket emails use HTML and text parts, a QR in the body (inline CID image) and the PDF attached.
- `GET /tickets/:id/pdf` for download (owner only).
- Scenario: `confirmed-order`.
- Verify: an integration test reads Mailpit, checks the PDF page count equals the ticket count (seated and GA), and decodes the QR to the ticket code.

**C4.5 Web checkout + orders**

- Checkout review page (seats, total, hold countdown) → redirect to the payment page.
- The return page polls the order using `retryAfterMs`, with clear processing, confirmed, failed and expired states and retry or "back to event" actions.
- My orders and tickets pages with PDF download.
- Verify: component tests for every status (MSW), and a manual full purchase showing the ticket email in Mailpit.

**M4 demo:** a full purchase end to end; a decline card gives a failed order with the seats released; a delayed card shows "processing" for a while.

---

## M5 — Ticket drops

| ID   | Chunk                               | Depends on |
| ---- | ----------------------------------- | ---------- |
| C5.1 | Waiting room API + admission job    | C3.2, C2.1 |
| C5.2 | Web: waiting room                   | C5.1, C3.3 |
| C5.3 | Rate limiting + test API limits     | C1.3       |
| C5.4 | Drop scenarios + testing guide pass | C5.1–C5.3  |

**C5.1 Waiting room API**

- Admin drop settings: `salesOpenAt`, `waitingRoomEnabled`, `admissionRatePerSec`, admission token TTL.
- `POST /events/:id/queue` → queue token (idempotent per user, using a Redis sorted set scored by join time). Before `salesOpenAt` everyone joins in a random order at open; after open, by join order. This rule is documented.
- `GET /queue/:token` returns position, estimated wait, `retryAfterMs`, and `admitted` with an admission token.
- An admission job uses the clock and admits N per second.
- The seat map and holds of drop events require a valid admission token. Without one you get 403 with the code `QUEUE_REQUIRED`.
- Queue length and admission rate are exported to `/metrics`.
- Verify: integration tests with a frozen clock (before open → advance → admitted in batches of N), an expired admission token, and joining twice returning the same token.

**C5.2 Web: waiting room**

- Pre-sale countdown, queue page with position and estimated wait (polling), a live region for position changes, and an automatic move to the seat map when admitted.
- Verify: component tests for every queue state, plus axe checks.

**C5.3 Rate limiting**

- `@nestjs/throttler` with Redis storage. Limits per route group are set through env.
- `X-Load-Test-Key` lifts limits; `/__test/*` gets its own limit and an audit log line.
- 429 responses include `Retry-After`.
- Verify: integration tests that exceed a limit, bypass it with the key, and check the test API limit.

**C5.4 Drop scenarios + testing guide**

- Scenarios: `drop-in-5-min`, `drop-open-now`, `large-venue-drop` (sized for k6).
- `docs/testing-guide.md` is completed: test mode, test API reference, all scenarios, test cards, the clock, data-isolation patterns and the polling contract (`retryAfterMs`).
- Verify: each scenario runs from a clean reset, and the guide examples run as written (a script runs the curl examples in CI).

**M5 demo:** schedule a drop 5 minutes ahead, fast-forward the clock, many clients queue and get admitted at the configured rate.

---

## M6 — Ship v1.0

| ID   | Chunk                                   | Depends on |
| ---- | --------------------------------------- | ---------- |
| C6.1 | Dockerfiles + `full` profile + GHCR     | M4         |
| C6.2 | Observability profile                   | C6.1, C5.1 |
| C6.3 | Hosted demo deployment                  | C6.1       |
| C6.4 | Release automation + tests repo trigger | C6.1       |
| C6.5 | v1.0 hardening pass                     | all        |

**C6.1 Images**

- Multi-stage Dockerfiles for api (with a separate worker command), web (static build served by Caddy) and fake-payments. Non-root users and health checks.
- Compose `full` profile runs everything. API replicas sit behind Caddy.
- CI builds the images and pushes to GHCR on `main` (SHA tag) and on tags (semver tag).
- Verify: from a clean machine, `docker compose --profile full up` passes a smoke script (health checks, a test purchase through the API).

**C6.2 Observability**

- `observability` profile: Prometheus scraping api and worker, plus Grafana with a provisioned "Ticket drop" dashboard (request rate and latency, holds, 409s, queue length, admissions, orders by status, job lag).
- Verify: a short local load script makes the dashboard panels move.

**C6.3 Hosted demo** _(needs your input: VPS, domain, secrets)_

- Production compose on the VPS: Caddy with automatic TLS, `TEST_API_KEY`, `LOAD_TEST_KEY`, webhook secret; Mailpit UI exposed with basic auth or read-only.
- Deploy workflow (SSH + `docker compose pull && up -d`) and a nightly reset cron.
- Verify: a public smoke check against the demo URL and a nightly reset log entry.

**C6.4 Release automation**

- Semver tags, a changelog generated from Conventional Commits, and a GitHub Release with `openapi.json` attached.
- On release, a `repository_dispatch` with the image tag is sent to the tests repo.
- Verify: a `v0.x` pre-release runs the whole flow.

**C6.5 v1.0 hardening**

- Pass through security headers, error messages, edge-case review, dependency audit, a README polish and a full accessibility audit of the main flows. Then tag `v1.0.0`.

---

## Later (post v1, already decided as deferred)

- Bug toggles (`GET/PUT /__test/bugs`) with the candidate bugs from tech-stack §4.
- SSE for queue position and order status.

## Resolved questions

| #   | Question                                | Answer                                                                                                                   |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | GitHub repo                             | https://github.com/azeljkovic/testtix, commits as `azeljkovic`, local folder `/Users/aleksandar/code/aleksandar/testtix` |
| 2   | Seated only, or also general admission? | Both in v1 (shared `InventoryUnit` model, see C1.2, C3.1, C3.3)                                                          |
| 3   | Currency and locale                     | USD, English UI                                                                                                          |
| 4   | Max tickets per order                   | 6, configurable per event (default)                                                                                      |
| 5   | Guest checkout?                         | No, account with verified email required (default)                                                                       |
| 6   | Fake-payments framework                 | NestJS, for shared tooling (default)                                                                                     |
| 7   | Changelog tooling                       | Conventional Commits + release-please (default)                                                                          |
