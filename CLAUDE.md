# TestTix — notes for Claude Code

TestTix is a sample event ticket shop (concerts, talks, meetups; seated and general-admission tickets) built as a realistic target for software testing practice. The app must be **correct and testable**: v1 ships with no intentional bugs.

## Source-of-truth docs

- `docs/development-plan.md` — milestones and chunks (C0.1 … C6.5), definition of done, resolved questions. **Work from this plan.**
- `docs/tech-stack-decisions.md` — architecture and tooling decisions. Don't change a **[Decided]** item without asking; **[Proposed]** items may be adjusted, but record the change in that doc in the same PR.
- `docs/idea.md` — product idea and the failure modes each feature exists to demonstrate.

When a decision changes, update the docs in the same PR so they stay accurate.

## Current status

- ✅ C0.1 Monorepo scaffold (initial commit on `main`)
- ✅ C0.2 CI skeleton
- ✅ C0.3 Local infra
- ✅ C0.4 API skeleton
- ✅ C0.5 Prisma + integration harness
- ✅ C0.6 Web skeleton
- ✅ C0.7 Shared schemas + OpenAPI client pipeline
- ✅ C1.1 Test mode + ClockService
- ✅ C1.2 Domain data model + deterministic seed
- ✅ C1.3 Test API: reset, seed scenarios
- ✅ C1.4 Auth API (sessions, roles, CSRF)
- ✅ C1.5 Mailer + account verification email
- ✅ C1.6 Web auth pages
- ✅ C2.1 Admin events + ticket batches API
- ✅ C2.2 Public catalogue API
- ✅ C2.3 Web: event list + detail
- ✅ C2.4 Web: admin area
- ✅ C3.1 Seat map + holds API (atomic)
- ✅ C3.2 BullMQ setup + hold sweeper
- ✅ C3.3 Web: accessible seat map
- ✅ C3.4 Web: hold flow + countdown
- ✅ C4.1 Fake payments service
- ✅ C4.2 Orders API
- ✅ C4.3 Webhook handling + order processing jobs
- ✅ C4.4 Ticket generation + e-ticket email
- ✅ C4.5 Web: checkout, order status, my tickets
- ✅ C5.1 Waiting room API + admission job
- ✅ C5.2 Web: waiting room
- ✅ C5.3 Rate limiting + test API limits
- ✅ C5.4 Drop scenarios + testing guide pass
- ✅ C6.1 Dockerfiles + `full` profile + GHCR
- ✅ C6.2 Observability profile
- 🟡 C6.3 Hosted demo: repo side done; live check waits for the VPS (see plan)
- 🟡 C6.4 Release automation: repo side done; the first release (live check) follows the merge (see plan)
- ⏭️ Next: **C6.5** (see plan)

Update this list when a chunk is merged.

## Workflow

- One chunk = one branch = one PR into `main`. Branch names: `c0-2-ci-skeleton`, `c3-1-seat-holds-api`.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`), with the chunk ID in the subject or body. Changelogs are generated from these later (release-please).
- Before opening a PR, run `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm format:check`, plus `pnpm openapi:check` if the API changed, and `pnpm docs:examples` (local API in test mode; it resets the data) if `docs/testing-guide.md` changed.
- The PR description lists verification steps and their results (commands, curl calls, URLs).
- Follow the plan's **Definition of done** for every chunk.

## Commands

Requires Node 24 (`.nvmrc`, `engine-strict=true`) and pnpm via Corepack (`packageManager` in `package.json`).

```sh
pnpm install
pnpm build          # turbo, cached
pnpm typecheck
pnpm lint
pnpm test
pnpm format         # / format:check
```

Run one package: `pnpm --filter @testtix/api <script>`.

## Conventions and gotchas

- **TypeScript is pinned to 6.0.x.** typescript-eslint doesn't support TS 7 yet; don't bump until it does.
- TS 6 defaults `types` to `[]`. Node packages extend `@testtix/config/tsconfig/node.json` (which sets `types: ["node"]`); add other ambient types (e.g. `vitest/globals`) explicitly.
- ESM everywhere (`"type": "module"`, `NodeNext` resolution for Node packages, `Bundler` for `apps/web`). Relative imports in Node packages need `.js` extensions. ESM was kept for NestJS in C0.4 (see tech-stack §3).
- ESLint uses `typescript-eslint` `strictTypeChecked` + Prettier; shared config lives in `packages/config/eslint.js`.
- **NestJS is pinned to 11.x** because `nestjs-zod` doesn't support 12 yet; don't bump until it does.
- Nest DI relies on decorator metadata: `apps/api` sets `experimentalDecorators` + `emitDecoratorMetadata`, and Vitest transforms with `unplugin-swc`. Inject interfaces/types with `@Inject(TOKEN)` and `import type`; classes can be injected by type.
- API tests that don't need real infra use `createTestApp()` (`apps/api/src/testing/test-app.ts`): the real modules and `configureApp()`, with Postgres and Redis faked. Keep app-level setup in `configureApp()` so `main.ts` and tests share it.
- Integration tests are `*.int.test.ts` files run by `pnpm test:integration` (Vitest project `integration`) against real Postgres and Redis: Testcontainers by default (Docker must be running), or `TEST_DATABASE_URL` / `TEST_REDIS_URL`. Boot the app with `createIntegrationApp()` (`apps/api/src/testing/integration/`). Each file starts with empty tables and Redis; files run one at a time.
- Prisma 7: the client is generated into `apps/api/src/generated/prisma` (git-ignored; turbo's `generate` task runs first). Import it from `../generated/prisma/client.js` and inject `PrismaService`. After a schema change, create a migration with `pnpm db:migrate --name <change>` (needs local infra) and commit it.
- Timestamp columns are `timestamptz` with no `now()` default and no `@updatedAt`: pass `createdAt` / `updatedAt` from `ClockService`. CHECK constraints Prisma can't express are appended by hand to the migration SQL (Migrate leaves them alone); run `pnpm --filter @testtix/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` to confirm no drift.
- Prisma enum values must equal the arrays in `packages/shared` (`src/infra/prisma-enums.test.ts` checks it). Add the shared array first.
- Seed (`apps/api/src/seed/`): `buildSeedData(now)` is pure and day-anchored; seed rows get stable IDs from `seedId(key)`, never `@default(uuid(7))`. Fixture slugs and IDs are documented in `docs/testing-guide.md` — never change them. `pnpm db:seed` only seeds an empty database (`pnpm db:reset && pnpm db:seed`). Compare database states in tests with `dataHash()` (`src/testing/integration/data-hash.ts`).
- **OpenAPI pipeline:** after changing an API route or schema, run `pnpm openapi` and commit `apps/api/openapi.json` and `apps/web/src/api/generated/` (CI's `pnpm openapi:check` fails otherwise). Never edit the generated files by hand.
- `packages/shared` holds enums (`ROLES`, `ORDER_STATUSES`), error codes (`PROBLEM_TYPES`, problem `type` = `urn:testtix:problem:<kebab-code>`) and `ProblemDetailsSchema`. Use them instead of string literals on both sides; add a code to `PROBLEM_TYPES` when adding an app-specific error.
- Every API error goes through `ProblemDetailsFilter` (problem+json). Throw Nest `HttpException`s or let Zod DTOs fail; don't hand-roll error bodies.
- New API env vars go in `apps/api/src/config/config.schema.ts` and `.env.example`.
- The API runs on **Fastify** (`@nestjs/platform-fastify`). Use `FastifyRequest` / `FastifyReply` types, never Express ones. `createHttpAdapter()` in `apps/api/src/app.setup.ts` builds the adapter for `main.ts` and tests.
- Root `package.json` `pnpm.ignoredBuiltDependencies` records that skipping install scripts is deliberate (`@scarf/scarf` is telemetry, `@swc/core`'s only re-checks its binary). pnpm still prints its "Ignored build scripts" reminder; that's expected.
- Web (`apps/web`): routes live in `src/app/routes.tsx`, shared by the browser router and tests. Component tests render the whole app with `renderApp(path)` (`src/testing/render.tsx`) and mock the API with MSW (`src/testing/msw-server.ts`; an unmocked request fails the test). Call the API through the typed client `api` (`src/api/client.ts`) and `unwrap()` the result (non-2xx → `ApiError` with `problem` and `code`). Type MSW mock bodies with `Schemas[...]` from `src/testing/msw-server.ts`. Set page titles with `<PageTitle title="…" />`. Axe checks use `axe` from `src/testing/axe.ts`.
- React hooks lint rules come from `config({ react: true })` in `@testtix/config/eslint`.
- Web admin (`src/admin/`, pages in `src/pages/admin/`): forms whose values aren't the request (numbers as text, dollars, wall-clock times) use `requestResolver(SharedSchema, convert)` (`src/forms/request-resolver.ts`) instead of `zodResolver`; show `formLevelError(formState.errors)` above the form. Event times are entered in the venue's time zone (`fromZonedLocal()` / `toZonedLocal()`). Edits PATCH only changed fields. After a change call `eventChanged()` / `venueChanged()` (`src/admin/queries.ts`). Native selects, date-times and checkboxes are in `src/forms/NativeFields.tsx`; confirm irreversible actions with `ConfirmButton`. In tests, MSW serves the admin fixtures (`src/testing/admin-fixtures.ts`) by default; `mockAdminRequest(method, path, respond)` (`src/testing/admin.ts`) answers and records calls (body, CSRF header).
- Web catalogue (`src/catalogue/`): the event list's state is the URL query (`parseListParams()` / `toSearchParams()` / `toApiQuery()` in `list-params.ts`); change it with `setSearchParams`, never local state. Catalogue queries come from `catalogueQueries`. MSW serves catalogue fixtures by default (`src/testing/catalogue-fixtures.ts`); override the list with `mockEventList(respond)` (`src/testing/catalogue.ts`), which also records each request's query. Fake timers in component tests: fake only `setTimeout` / `clearTimeout` and type with `fireEvent`, since user-event's async wrapper waits on a real timer. To fake the clock too (`Date`), use `fakeClockAt()` / `settleWithFakeClock()` / `advanceClock()` from `src/testing/fake-clock.ts`.
- Web seat map (`src/seats/`, page `src/pages/ChooseSeatsPage.tsx`): hand-built ARIA grid (`SeatGrid`, keys in `grid-navigation.ts`) and spin button (`GaStepper`; React Aria's `NumberField` has no `spinbutton` role). Selection logic is pure in `selection.ts` (`summarize()`, `pruneSelection()`); announce changes through the page's one `role="status"`. In tests, MSW serves the seat map fixtures (`src/testing/seat-fixtures.ts`, seat IDs from `fixtureSeatId()`); override with `mockSeatMap(eventId, respond)` and change seats with `withSeatStatus()` (`src/testing/seats.ts`). Holds: API calls in `src/api/holds.ts` (`ticketsUnavailable(error)` reads a 409's lists), the current hold is `seatQueries.currentHold(eventId)`, and the countdown is `useCountdown()` (`src/seats/countdown.ts`): always `expiresAt − Date.now()`, never decremented per tick. In tests, `holdOf(map, request)`, `mockCurrentHold()`, `mockCreateHold()`, `mockReleaseHold()` and `ticketsUnavailableResponse()` are in `src/testing/holds.ts`; MSW answers `GET /holds/current` with 404 by default.
- Web checkout + orders (`src/orders/`, pages `CheckoutPage`, `OrderPage`, `OrdersPage`): API calls in `src/api/orders.ts`; `orderQueries.order(id)` polls with `refetchInterval` = the last response's `retryAfterMs` (null stops it). Leave the app (the payment page) through `browserLocation.assign()` (`src/app/browser-location.ts`), which tests replace with `vi.spyOn`. Held/ordered tickets and the countdown render with `HeldTickets` / `TimeLeft` (`src/seats/HeldTickets.tsx`). In tests, `orderOf(hold, event, { status })`, `mockOrder(id, ...answers)` (answers in turn, returns request times), `mockCreateOrder()`, `mockOrderList()` and `orderPage()` are in `src/testing/orders.ts`; MSW answers `GET /orders` with an empty page and `GET /orders/:id` with 404 by default. `fakeClockAt()` also fakes `setInterval`, so polling follows `advanceClock()`.
- Web waiting room (`src/waiting-room/`, page `WaitingRoomPage`): the queue entry is `queueQueries.entry(eventId)` (first fetch joins with `POST`, then polls `GET /queue/{token}` by `retryAfterMs`); the seat map page gates a drop with `useAdmission(event)` and passes its token to `seatQueries.seatMap(eventId, token)` and `createHold(…, token)`. Invalidate seat maps with `seatQueries.seatMapKey(eventId)`. On a 403 `queue-required` call `recheckAdmission()`. In tests, the drop fixture is `dropDetail` / `dropSeatMap` (MSW serves its map only with `FIXTURE_ADMISSION_TOKEN`); `queueEntryOf(event, { status })`, `mockJoinQueue(eventId, ...answers)`, `mockQueueEntry(token, ...answers)` and `admissionTokenOf(request)` are in `src/testing/waiting-room.ts`. `mockAdminRequest()` records `headers` too.
- Web auth: read the session with `useSession()` (`src/auth/session.ts`; `null` when logged out). Guard routes with layout routes `<RequireAuth />` / `<RequireAuth role="ADMIN" />` in `routes.tsx`. Every state-changing API call passes `params: { header: await csrfHeader() }` (the spec makes the header required). In tests, `logInAs(user)` with `customer` / `admin` from `src/testing/auth.ts`, and `problemResponse()` from `src/testing/problems.ts` for API errors.
- Web forms: React Hook Form + `zodResolver(<shared request schema>)`, fields via `TextField` (`src/forms/`), and `showSubmitError()` for API errors. User-facing validation messages live in the shared schemas. Don't use React Aria's `isPending` on buttons (its live-region announcement dangles after navigation and fails axe); use `SubmitButton`.
- Run Prettier from the repo root (`pnpm format`): run inside a package, it misses the root `.prettierignore` and reformats generated files.
- Money is stored as integer cents, currency USD, locale `en-US` (`packages/shared`).
- `packages/shared` is compiled to `dist/`; turbo runs `^build` before dependants' typecheck, lint, test and dev.
- Pin exact dependency versions (no `^`), matching the existing `package.json` files.
- Server code must take "now" from `ClockService` (`await clock.now()`; global, inject by type), never `Date.now()` / `new Date()` directly. ESLint enforces it in `apps/api/src` (tests and `src/testing/` are exempt).
- Test-only endpoints go in `TestApiModule` (`apps/api/src/test-api/`, routes under `/__test/`), which is loaded only when `TESTTIX_TEST_MODE=true`. Put `@RequiresTestKey()` on endpoints with a global effect (clock, reset). Tests turn test mode on with `env: { TESTTIX_TEST_MODE: 'true' }`; the clock is global, so tests that change it reset it.
- `docs/testing-guide.md` examples must run as written: every ` ```sh ` block runs in CI (`pnpm docs:examples`) after a reset, and curl's 4xx/5xx fail it. Build data with scenarios and test sessions, not placeholders; mark blocks with `<!-- example: group=<name> -->` (share variables), `http-errors` or `skip <reason>` on the line before.
- `POST /__test/reset` reseeds via `resetAndSeedDatabase()` (truncate + seed in one transaction). Seed scenarios (`src/test-api/scenarios/`) are one route each under `/__test/seed/`, built by pure functions that reuse `buildCatalogue()`; they only add rows, with random IDs (`uuidv7(now)`) and a random suffix in slugs, titles and emails. Document new scenarios in `docs/testing-guide.md`. Drop scenarios (`makeDrop()` in `scenarios.ts`) set `salesOpenAt` relative to now in whole seconds; queues can't be pre-filled.
- **Auth is deny-by-default.** The global `AuthGuard` requires a session on every route; mark open routes (or controllers) `@Public()`, restrict with `@Roles('ADMIN')`, read the user with `@CurrentUser()` (`src/auth/auth.decorators.ts`). The global `CsrfGuard` requires `X-CSRF-Token` on every POST/PUT/PATCH/DELETE unless `@SkipCsrf()`. New test API controllers use `@TestApiController(path)` (public, no CSRF). In tests, `openBrowser(app)` / `createTestSession(app, { role })` (`src/testing/auth.ts`) give a logged-in client, and `sessionClient(app, session)` sends its cookie and CSRF header for you; `createIntegrationApp({ controllers })` adds probe routes.
- Prisma unique-constraint races: catch `P2002` (`isUniqueViolation()` / `isForeignKeyViolation()` in `src/infra/prisma-errors.ts`) rather than checking first. Batch inserts go through `chunks()` (`src/infra/chunks.ts`) to stay under Postgres' bind-parameter limit.
- Event writes (edits, status actions, batch releases) start their transaction with `lockEvent()` (`src/events/admin-events.service.ts`), and venue layout writes with `lockVenue()`; keep that order (event, then venue) in new code. Rules a schema can't check answer 400 via `validationFailed(errors)`; state conflicts get their own 409 problem type.
- Public catalogue figures (`src/events/catalogue-query.ts`) count **released** tickets only and treat expired holds as available; filters and sorts on computed columns go in that SQL, not in JS, so pagination stays exact.
- Holds (`src/holds/holds.service.ts`): claim inventory only through its locking order (event `FOR SHARE` → per-user advisory lock → units `ORDER BY id FOR UPDATE` → conditional `UPDATE`; GA with `SKIP LOCKED`). Expired = `held_until <= now`. A 409 that carries data uses `ProblemException`'s `extensions` plus a shared schema registered in `addProblemDetailsResponses()`. Scenario rows can include `holds` (`holdUnits()` in `scenario-data.ts`).
- Orders (`src/orders/`): one order per hold (`orders.hold_id` unique); the order owns its hold, and `deleteHold()` expires its `PENDING_PAYMENT` order, so every hold change goes through it. Show order status via `effectiveStatus()` (lazy expiry). Call the payment provider only through `PaymentsClient` (`src/payments/`), never inside a transaction. In tests, point `PAYMENTS_BASE_URL` at `startPaymentProviderStub()` (`src/testing/payment-provider-stub.ts`); the sweeper isn't loaded with the worker off, so call `new HoldSweeperService(prisma, clock).sweep()`.
- Payment webhooks + order processing (`src/orders/payment-webhooks.*`, `order-processing.*`): the signature is checked on `request.rawBody` (`APP_OPTIONS` sets `rawBody: true`) against `clock.realNow()`, never the test clock. Each provider event is recorded once with an `outcome` (`PAYMENT_EVENT_OUTCOMES`); a success no order can use is `REFUND_DUE`, never sold. `startProcessing()` moves an order to `PROCESSING` by taking its units off the hold as `SOLD` and deleting the hold; only `OrderProcessingService.finalize()` then confirms or fails it (the place to hook confirmation side effects). Enqueue through `OrderJobs` (best effort; the `recover` schedule catches up). In tests, sign webhooks with `sendWebhook()` / `paymentEvent()` (`src/testing/webhooks.ts`), run `finalize()` directly, and share checkout setup via `src/testing/integration/checkout.ts`; `startFakePayments()` gives the real provider (built from its Dockerfile, or `TEST_PAYMENTS_URL`).
- Tickets + e-ticket email (`src/tickets/`): `finalize()` issues tickets in its confirming transaction (`issueTickets()`), then enqueues `send-tickets` (`TicketEmailService.send()`, at least once, guarded by `orders.tickets_emailed_at`; the `recover` schedule catches up). Ticket text comes from `loadTicketDetails()` / `placeLabel()`; PDFs from `renderTicketsPdf()` (standard Helvetica, so pass text through `pdfText()`). Scenario orders set `ticketsEmailedAt` so they never email. In tests, construct `TicketEmailService` directly (worker off), read attachments with `emailPart()` (`mailpit.ts`), and check documents with `pdfPageCount()` / `qrCodesInPdf()` / `decodeQrPng()` (`src/testing/documents.ts`); fetch binary responses with `.buffer(true).parse(binaryBody)`.
- Background jobs (`src/jobs/`): register processors and job schedules in `WorkerModule`, which runs in the API (`WORKER_IN_PROCESS=true`, default) or alone via `src/worker.ts` (`WorkerAppModule`); so never rely on API-only providers in a processor. Use job schedulers (`upsertJobScheduler`, via a `JobSchedule` subclass), not the old repeatable-job API. Hold changes outside `HoldsService` reuse `src/holds/hold-locks.ts`. Test harnesses run with the worker off; pass `env: { WORKER_IN_PROCESS: 'true' }` to `createIntegrationApp()` to turn it on (and empty the queue first).
- Waiting room (`src/waiting-room/`): queue state lives in Redis only (`QueueStore`, `testtix:queue:*`); atomic changes are Lua scripts there, and times are server-clock values passed in (never Redis TTLs). The seat map and new holds of a drop event go through `WaitingRoomService.requireAdmission()` in `HoldsController` (header `ADMISSION_TOKEN_HEADER`, 403 `QUEUE_REQUIRED`). Admission is `QueueAdmissionService.admit()` (worker job `waiting-room`, `QUEUE_ADMISSION_INTERVAL_MS`): rate × batches due by the server clock. In tests with the worker off, build `new QueueAdmissionService(prisma, clock, app.get(QueueStore, { strict: false }))` and call `admit()` after moving the clock.
- Rate limits (`src/rate-limit/`): every route counts towards the `default` group; add one to another with `@RateLimit(group)` (groups and their env vars in `rate-limit-groups.ts`; `testApi` replaces `default`, `verificationResend` is per user and needs a session), and take health-style routes out with `@NoRateLimit()`. The global guard runs before `AuthGuard` (keep `RateLimitModule` before `AuthModule` in `AppModule`). Counters are Redis keys `testtix:ratelimit:*`, cleared by `POST /__test/reset`. Both test harnesses turn limits off; pass `env: { RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_DEFAULT: '3/1m' }` to `createIntegrationApp()` to test them.
- List endpoints paginate with `PageQuerySchema` / `pageSchema()` / `toPage()` from `packages/shared`. Generated slugs use `slugify()` + `insertWithSlug()` (`src/infra/slugs.ts`).
- Prefer accessible names over `data-testid` in the UI; use `data-testid` only where no good accessible locator exists.
- Every list endpoint sorts with a stable tiebreaker (`id`).
- Email: send through `MailService.send({ to, template, data })` (`src/mail/`); add the template's variables to `MailTemplateData` and its `<name>.html.hbs` / `<name>.text.hbs` to `apps/api/templates/mail/` (Prettier ignores `*.hbs`). Integration tests read mail with `waitForEmail(to, subject)` (`src/testing/integration/mailpit.ts`); Mailpit is never emptied, so use a unique recipient. `createTestApp()` swaps SMTP for a JSON transport.
- Fake payments (`apps/fake-payments`, NestJS on Fastify, port 4000): in-memory sessions, test cards in `src/cards/test-cards.ts` (keep `docs/testing-guide.md#payments` in sync), webhooks via `WebhookDispatcher`. The contract (request/session/event schemas, signature headers) is in `packages/shared/src/payments.ts`; the API must use it rather than its own copies. The payment page is built with the `markup` tagged template (`src/page/html.ts`), which escapes every value; don't rename it `html` (Prettier would reformat the templates). App tests use `createTestApp()` + `app.inject()` (`src/testing/test-app.ts`, `FakeClock` to move time); `*.int.test.ts` deliver real webhooks to `WebhookReceiver` (`src/testing/webhook-receiver.ts`). Compose builds its image from `apps/fake-payments/Dockerfile`; `pnpm infra:up --build` after code changes.
- Images (C6.1): `apps/{api,web,fake-payments}/Dockerfile`, built from the repo root. The api image is also the worker (`node dist/worker.js`) and the migrations (`migrate` service). New API env vars a container needs go in the `x-api-environment` anchor of `docker/compose.yml` (pass tunables as `${VAR:-}`). New files the API reads at runtime must be in `files` of `apps/api/package.json` (`pnpm deploy` ships only those). The worker serves only health routes (`createWorkerApp()`, `WORKER_PORT`). Check container changes with `pnpm full:up --build && pnpm full:check` (resets the data); CI's `images` job does the same and `publish` pushes to GHCR.
- Metrics (`/metrics`, C6.2): register on the injected `METRICS_REGISTRY` (`src/metrics/metrics.tokens.ts`; import `MetricsModule`), names `testtix_*`, labels never raw paths or user input. Per-process counts are counters/histograms; values from Postgres/Redis are gauges read in `collect()` at scrape time with the server clock, catching errors so the scrape still answers. BullMQ processors and queues get job metrics automatically (`JobMetrics`). The dashboard is `docker/observability/grafana/dashboards/ticket-drop.json` (`pnpm observability:check` runs each of its queries); document new metrics in `docs/testing-guide.md#metrics`.
- Hosted demo (C6.3, `docs/hosted-demo.md`): `docker/demo/compose.yml` overlays the `full` profile (run it with `docker/demo/compose.sh`); `edge` (`docker/demo/Caddyfile`) serves `DEMO_DOMAIN`, `api.`, `pay.` and `mail.` with TLS and keeps `/metrics` private. Settings the demo needs go in the overlay (secrets as `${VAR:?}`) and in the `.env` the **Demo deploy** workflow writes from the `demo` environment. A new public path or host needs a check in `docker/demo-smoke-test.sh` (`pnpm demo:check`); test the setup locally with `DEMO_DOMAIN=localhost` (see the runbook).
- Releases (C6.4, `docs/releasing.md`): release-please keeps a release PR open from the Conventional Commits on `main`; never bump versions, edit `CHANGELOG.md` or push `v*` tags by hand. One version for the repo: a new workspace `package.json` (or another file carrying the version) goes into `extra-files` in `release-please-config.json`. Releases reuse CI's `sha-<7>` images (`.github/workflows/release.yml`); the tests repo gets a `testtix-release` dispatch, whose payload is a documented contract.
- Local infra is `docker/compose.yml`, driven by `pnpm infra:*` from the repo root (`--project-directory .`, so the root `.env` overrides the compose defaults). Pin image tags to an exact version. New services get a health check, and `docker/smoke-test.sh` checks them.

## Repo

https://github.com/azeljkovic/testtix — public, MIT. Tests coupled to the code (unit, component, API integration) live here; UI/API e2e and k6 performance tests live in a separate repository.
