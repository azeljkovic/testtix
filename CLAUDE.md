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
- ⏭️ Next: **C3.1 Seat map + holds API (atomic)** (see plan)

Update this list when a chunk is merged.

## Workflow

- One chunk = one branch = one PR into `main`. Branch names: `c0-2-ci-skeleton`, `c3-1-seat-holds-api`.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`), with the chunk ID in the subject or body. Changelogs are generated from these later (release-please).
- Before opening a PR, run `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm format:check`, plus `pnpm openapi:check` if the API changed.
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
- Web catalogue (`src/catalogue/`): the event list's state is the URL query (`parseListParams()` / `toSearchParams()` / `toApiQuery()` in `list-params.ts`); change it with `setSearchParams`, never local state. Catalogue queries come from `catalogueQueries`. MSW serves catalogue fixtures by default (`src/testing/catalogue-fixtures.ts`); override the list with `mockEventList(respond)` (`src/testing/catalogue.ts`), which also records each request's query. Fake timers in component tests: fake only `setTimeout` / `clearTimeout` and type with `fireEvent`, since user-event's async wrapper waits on a real timer.
- Web auth: read the session with `useSession()` (`src/auth/session.ts`; `null` when logged out). Guard routes with layout routes `<RequireAuth />` / `<RequireAuth role="ADMIN" />` in `routes.tsx`. Every state-changing API call passes `params: { header: await csrfHeader() }` (the spec makes the header required). In tests, `logInAs(user)` with `customer` / `admin` from `src/testing/auth.ts`, and `problemResponse()` from `src/testing/problems.ts` for API errors.
- Web forms: React Hook Form + `zodResolver(<shared request schema>)`, fields via `TextField` (`src/forms/`), and `showSubmitError()` for API errors. User-facing validation messages live in the shared schemas. Don't use React Aria's `isPending` on buttons (its live-region announcement dangles after navigation and fails axe); use `SubmitButton`.
- Run Prettier from the repo root (`pnpm format`): run inside a package, it misses the root `.prettierignore` and reformats generated files.
- Money is stored as integer cents, currency USD, locale `en-US` (`packages/shared`).
- `packages/shared` is compiled to `dist/`; turbo runs `^build` before dependants' typecheck, lint, test and dev.
- Pin exact dependency versions (no `^`), matching the existing `package.json` files.
- Server code must take "now" from `ClockService` (`await clock.now()`; global, inject by type), never `Date.now()` / `new Date()` directly. ESLint enforces it in `apps/api/src` (tests and `src/testing/` are exempt).
- Test-only endpoints go in `TestApiModule` (`apps/api/src/test-api/`, routes under `/__test/`), which is loaded only when `TESTTIX_TEST_MODE=true`. Put `@RequiresTestKey()` on endpoints with a global effect (clock, reset). Tests turn test mode on with `env: { TESTTIX_TEST_MODE: 'true' }`; the clock is global, so tests that change it reset it.
- `POST /__test/reset` reseeds via `resetAndSeedDatabase()` (truncate + seed in one transaction). Seed scenarios (`src/test-api/scenarios/`) are one route each under `/__test/seed/`, built by pure functions that reuse `buildCatalogue()`; they only add rows, with random IDs (`uuidv7(now)`) and a random suffix in slugs, titles and emails. Document new scenarios in `docs/testing-guide.md`.
- **Auth is deny-by-default.** The global `AuthGuard` requires a session on every route; mark open routes (or controllers) `@Public()`, restrict with `@Roles('ADMIN')`, read the user with `@CurrentUser()` (`src/auth/auth.decorators.ts`). The global `CsrfGuard` requires `X-CSRF-Token` on every POST/PUT/PATCH/DELETE unless `@SkipCsrf()`. New test API controllers use `@TestApiController(path)` (public, no CSRF). In tests, `openBrowser(app)` / `createTestSession(app, { role })` (`src/testing/auth.ts`) give a logged-in client, and `sessionClient(app, session)` sends its cookie and CSRF header for you; `createIntegrationApp({ controllers })` adds probe routes.
- Prisma unique-constraint races: catch `P2002` (`isUniqueViolation()` / `isForeignKeyViolation()` in `src/infra/prisma-errors.ts`) rather than checking first. Batch inserts go through `chunks()` (`src/infra/chunks.ts`) to stay under Postgres' bind-parameter limit.
- Event writes (edits, status actions, batch releases) start their transaction with `lockEvent()` (`src/events/admin-events.service.ts`), and venue layout writes with `lockVenue()`; keep that order (event, then venue) in new code. Rules a schema can't check answer 400 via `validationFailed(errors)`; state conflicts get their own 409 problem type.
- Public catalogue figures (`src/events/catalogue-query.ts`) count **released** tickets only and treat expired holds as available; filters and sorts on computed columns go in that SQL, not in JS, so pagination stays exact.
- List endpoints paginate with `PageQuerySchema` / `pageSchema()` / `toPage()` from `packages/shared`. Generated slugs use `slugify()` + `insertWithSlug()` (`src/infra/slugs.ts`).
- Prefer accessible names over `data-testid` in the UI; use `data-testid` only where no good accessible locator exists.
- Every list endpoint sorts with a stable tiebreaker (`id`).
- Email: send through `MailService.send({ to, template, data })` (`src/mail/`); add the template's variables to `MailTemplateData` and its `<name>.html.hbs` / `<name>.text.hbs` to `apps/api/templates/mail/` (Prettier ignores `*.hbs`). Integration tests read mail with `waitForEmail(to, subject)` (`src/testing/integration/mailpit.ts`); Mailpit is never emptied, so use a unique recipient. `createTestApp()` swaps SMTP for a JSON transport.
- Local infra is `docker/compose.yml`, driven by `pnpm infra:*` from the repo root (`--project-directory .`, so the root `.env` overrides the compose defaults). Pin image tags to an exact version. New services get a health check, and `docker/smoke-test.sh` checks them.

## Repo

https://github.com/azeljkovic/testtix — public, MIT. Tests coupled to the code (unit, component, API integration) live here; UI/API e2e and k6 performance tests live in a separate repository.
