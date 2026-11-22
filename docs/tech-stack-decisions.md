# TestTix — Tech stack decisions

Status: draft v2 (2026-11-17), updated for C1.2 (2026-11-21)
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
- **API calls** go to `/api/*` on the page's own origin. The Vite dev server proxies them to the API and strips the prefix; production gets the same rule from Caddy (C6.1). This avoids CORS entirely. Since C0.7 every call goes through the typed client (§3, "Shared schemas and the OpenAPI client").
- **Lint:** the shared ESLint config gains a `react` option with `eslint-plugin-react-hooks` (recommended rules, including the React Compiler checks). `eslint-plugin-jsx-a11y` is left out because it doesn't support ESLint 10 yet; axe checks in component tests cover accessibility.
- **Component tests:** Vitest with jsdom, React Testing Library and user-event. MSW 3 answers API calls (`onUnhandledFrame: 'error'`, so an unmocked request fails the test). `vitest-axe` 0.1 still declares its matcher types for an old Vitest, so `src/testing/axe.ts` re-declares `toHaveNoViolations` for Vitest's `Matchers` interface; jsdom can't measure colour contrast, so that axe rule is off in component tests and left to e2e.

**Auth pages (C1.6)**

- **Forms:** React Hook Form 7 with `@hookform/resolvers` 7 (`zodResolver`) and the request schemas from `packages/shared`, so the form and the API validate with the same rules. The shared schemas carry the human-readable messages the forms show (the API returns the same text in `errors`). `zod` is a direct dependency of the web app at the shared package's version. Fields are React Aria `TextField`s bound with RHF's `Controller` (`validationBehavior="aria"`, so no browser validation bubbles); a failed submit focuses the first invalid field.
- **Server errors:** `showSubmitError()` puts the problem's field `errors` on matching fields (e.g. `email` for `email-already-registered`) and anything else in a form-level `role="alert"`, worded per error code.
- **CSRF:** every state-changing call passes `params: { header: await csrfHeader() }`. The spec marks `X-CSRF-Token` required, so the typed client refuses a call without it. `csrfHeader()` reads the `testtix_csrf` cookie and calls `GET /auth/csrf` only when there's none.
- **Session:** one TanStack Query (`sessionQuery`, `GET /auth/me`) that is `null` when logged out (401). Login and register write the session into it; logout navigates home first (with `flushSync`, since React Router renders navigations as transitions and `navigate` can resolve before the new page is on screen), then clears it, so a guarded page doesn't bounce to the login page. `flushSync` needs the `RouterProvider` from `react-router/dom`.
- **Route guards** are layout routes (`<RequireAuth />`, `<RequireAuth role="ADMIN" />`) rather than loaders, so the route table stays a plain array shared with tests. Anonymous visitors go to `/login?redirectTo=…`; a logged-in user without the role sees "Access denied" at the same URL. `redirectTo` only accepts same-origin paths (no open redirect).
- **No React Aria `isPending` buttons.** It announces through a body-level live region whose node points at the button by ID; after a successful submit navigates away, that reference dangles for up to 7 s, and an axe scan flags it. Submit buttons are native buttons with `aria-disabled` while pending.
- The verification landing page runs `POST /auth/verify-email` as a query (not a mutation): it is idempotent, and a query runs once per token even when StrictMode mounts the page twice.
- The bundle passed Vite's 500 kB warning (about 670 kB, 210 kB gzipped, mostly React DOM, React Aria and Zod). After the catalogue pages (C2.3) it is about 705 kB (218 kB gzipped); route-level code splitting is still open.

**Event pages (C2.3)**

- **List state lives in the URL query** (`useSearchParams`), with the API's parameter names. `parseListParams()` (`src/catalogue/list-params.ts`) checks each value with the shared enum schemas and drops what the API wouldn't accept, so a hand-edited link never turns into a 400. Every change is a pushed history entry; the search box pushes one when its debounce fires, not per keystroke.
- **Debounce:** `SEARCH_DEBOUNCE_MS` (300) lives in `packages/shared` so tests outside the repo can use the same number. `SearchBox` keeps the typed text in local state and commits it after the pause through `useEffectEvent`, so a re-render (results arriving) doesn't restart the timer. Enter commits at once. When the URL's `q` changes from outside (back button, "Clear filters") the box takes the new value; its own commit doesn't overwrite what was typed since.
- **Native `<select>` and `<input type="date">`** for the filters rather than React Aria's `Select` / `DatePicker`: they are accessible as they are, behave the same in jsdom and real browsers, and are what most testers expect to drive (`selectOption`, `fill('2026-12-01')`). React Aria stays for menus and links.
- **Dates:** event times are shown in the venue's time zone (`Intl.DateTimeFormat` with `timeZone`), as printed on a ticket. The "From" / "To" filter days are local to the browser, with "To" included (the API's `to` is exclusive, so it gets the next midnight).
- **No `keepPreviousData`:** a new query shows the loading state (placeholder cards and "Loading events…") until its results arrive, so every list change has an observable loading → loaded transition; revisiting a list is instant from the cache.
- The app's query client doesn't retry 4xx responses (a 404 event, an invalid query); network errors and 5xx still get three retries.
- "Choose seats" links to `/events/:slug/seats`, the seat map (C3.3).

**Admin area (C2.4)**

- **Routes** sit under one `<RequireAuth role="ADMIN" />` layout route and an `AdminLayout` (an "Admin" sub-navigation): `/admin/events` (list, `?status=` and `?page=` in the URL), `/admin/events/new`, `/admin/events/:eventId` (details, status actions, batches), `…/edit`, `…/batches/new`, `/admin/venues`, `/admin/venues/new` and `/admin/venues/:venueId`. `/admin` redirects to `/admin/events`. Pages address events by ID, as the admin API does.
- **Venue pages are in scope** although the plan only names event pages: "seated, GA or mixed sections" come from the venue layout, so creating one needs the layout editor (`useFieldArray`). Releasing individual seats (`seatIds`) stays API-only until the seat map (C3.3) gives a seat picker.
- **Form values aren't requests.** Admin forms keep text as typed (numbers, dollars, wall-clock times). `requestResolver(schema, convert)` (`src/forms/request-resolver.ts`) converts the values, then validates the result with the shared request schema, so form and API share rules and messages; conversion errors (a malformed price, a skipped time) take the place of schema errors on their field, and errors on paths that aren't fields go to `root.schema`. Messages only a form can produce (dollar format, time zones) live in the web app.
- **Times are entered in the venue's time zone**, matching how they are shown and printed. `datetime-local` inputs hold wall-clock time; `fromZonedLocal()` / `toZonedLocal()` (`src/admin/zoned-time.ts`) convert with `Intl` only, no date library: a time that happens twice is the earlier instant, one the clocks skip is refused.
- **Edits send only changed fields:** the form's request is compared with the request built from the loaded event or venue, so an unchanged past `startsAt` isn't re-validated and an unchanged layout isn't replaced (which would issue new seat IDs).
- **Native controls** (`SelectField`, `DateTimeField`, `CheckboxField` in `src/forms/NativeFields.tsx`) as in the catalogue filters; text and number fields stay React Aria `TextField`s, with `inputMode` for numbers so testers can still type anything. Irreversible actions (cancel, delete) confirm in a React Aria `alertdialog`.
- **Caching:** a change writes the returned event into its query and marks the admin lists and the public catalogue stale (`eventChanged()` / `venueChanged()` in `src/admin/queries.ts`), so a published event shows up in `/events` straight away.
- `packages/shared` gains `BATCH_EMPTY_MESSAGE`, and a missing event time now says "Enter the start time" (API too) instead of the ISO 8601 format message.
- Bundle after C2.4: about 760 kB (232 kB gzipped). The admin pages are a good first candidate for route-level code splitting.

**Seat map (C3.3)**

- `/events/:slug/seats` loads the event by slug (for its ID, title and sections), then `GET /events/{eventId}/seats` (`seatQueries` in `src/seats/queries.ts`, `staleTime: 0` so it refetches on mount and window focus). It shows only the venue sections the event sells (the catalogue event's `sections`, which include scheduled releases), so a GA-only event at a mixed venue doesn't show a grid of unsellable seats.
- **Hand-built, no React Aria**, as decided: each seated section is a `role="grid"` labelled by its heading (`SeatGrid`), with a `rowheader` per row and a `gridcell` per seat. One tab stop per grid (roving tabindex, starting on the first available seat); arrows, Home / End and Ctrl+Home / Ctrl+End move (`nextPosition()` in `src/seats/grid-navigation.ts`), without wrapping; Enter or Space toggles. Keyboard and click handling is delegated to the grid and finds the seat by its `data-row` / `data-col`. Unavailable seats stay focusable with `aria-disabled="true"`; while the event isn't on sale the grid is `aria-readonly` and nothing has `aria-selected`.
- **Seat names** are "Stalls, row B, seat 12, $89.00, available"; the last part is the state (`selected` replaces `available`), so the state is in the name as well as in `aria-selected`, which screen readers announce inconsistently for grid cells. States differ by icon or shape as well as colour (number in an outline, tick, clock, cross, dashed outline), with a "Seat key" legend.
- **GA stepper is a hand-built spin button**, not React Aria's `NumberField`: in RAC 1.22 that renders a plain textbox (`aria-roledescription="Number field"`, no `spinbutton` role or `aria-valuemin` / `aria-valuemax`), so the limits wouldn't be announced. `GaStepper` is an `<input role="spinbutton">` with `aria-valuenow/min/max` (Arrow Up / Down, Page Up / Down by 5, Home / End; typed values are clamped on blur or Enter) between − / + buttons that use `aria-disabled` at the limits so they keep focus. Its maximum is the places left, capped by what the order limit leaves.
- **Selection** is page state (`Selection` in `src/seats/selection.ts`, shaped like a hold request), not the URL. `summarize()` checks it against the current map (venue, row, seat order; GA priced cheapest first like the API); when a refetched map takes seats away, `pruneSelection()` drops them (the "adjust state on prop change" pattern, no effect). The order's `maxTicketsPerOrder` covers seats and GA together; trying to go past it announces `HOLD_MESSAGES.tooMany()`.
- **Live region:** one `role="status"` (visually hidden) announces seat changes, − / + presses and removals with the new count and total, e.g. "Added Stalls, row A, seat 3. 1 ticket, $89.00 in total." A repeated message gets a no-break space appended so it is read again. Changes made in the spin button itself aren't announced twice. Removing a line in "Your selection" moves the focus to its heading.
- Bundle after C3.3: about 777 kB (237 kB gzipped).

**Hold flow (C3.4)**

- **API calls** live in `src/api/holds.ts`: `fetchCurrentHold()` (404 → `null`), `createHold()`, `releaseHold()` (404 counts as released) and `ticketsUnavailable(error)`, which reads the 409's `unavailableSeatIds` / `gaShortfalls` with the shared `TicketsUnavailableProblemSchema`. `ApiError` now keeps the raw `body`, since `ProblemDetailsSchema` strips extension members. The current hold is a query (`seatQueries.currentHold(eventId)`, enabled only with a session); creating and releasing write their result into it with `setQueryData`, and every hold change refetches the seat map.
- **Countdown from the browser clock**, as planned: `useCountdown()` (`src/seats/countdown.ts`) keeps the `Date.now()` of the last tick in state, shows `ceil((expiresAt − now) / 1000)` seconds, and sets one `setTimeout` to the next whole second, measured from `Date.now()` when the effect runs (not from the render's `now`, which may be late). Nothing is decremented per tick, so a throttled background tab and a faked clock (Playwright's `page.clock`, Vitest's fake timers) show the right time. Server and browser clocks are assumed to agree, with no skew correction: in test mode, tests that move the server clock move the browser's too. The server stays the authority: at "0:00" the page refetches the map, and the API refuses an expired hold anyway.
- **The map is read-only while a hold is active.** The seat map doesn't say whose hold a seat is in, so your own held seats show as `held`; editing a hold in place would need that. To change tickets, release and hold again. A new hold replaces the old one on the server anyway.
- **Focus:** the hold panel's heading takes the focus when a hold is made, and the "Your selection" heading when a hold is released (or expires while the focus is inside the panel), so the focus is never left on a button that disappeared. Announcements go through the page's one `role="status"`; the expiry banner and errors are `role="alert"`. The timer is `role="timer"` (not live), with a single "less than a minute" announcement instead of per-second chatter.
- **Hold button** is a native `disabled` button while nothing is chosen (or the session / current hold is loading) and `aria-disabled` while the request runs, like `SubmitButton`.
- **Tests with a fake clock:** `fakeClockAt(now)` (`src/testing/fake-clock.ts`) fakes `Date`, `setTimeout` and `clearTimeout`, as `page.clock` does. Testing Library's `waitFor` and user-event wait on a faked `setTimeout`, so tests wait with `settleWithFakeClock()` and click with `fireEvent`. The fetch stack only finishes once a faked clock moves, so `settleWithFakeClock()` moves it 1 ms per round and the test puts it back with `vi.setSystemTime()`; `advanceClock(ms)` moves a second per `act()`, so each tick's effect schedules the next one. MSW helpers in `src/testing/holds.ts` build holds from a seat map (`holdOf()`), and mock the current hold, creating, releasing and the 409 body.
- Bundle after C3.4: about 785 kB (239 kB gzipped).

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

**Shared schemas and the OpenAPI client (C0.7)**

- **`packages/shared`** holds what the API and the web app both need at runtime: enums (`ROLES`, `ORDER_STATUSES`, each with a Zod schema), error codes, the `ProblemDetails` schema and money constants. Response schemas only the API uses (e.g. health) stay in the API, and the web app gets their types from the spec. Request schemas that web forms validate with (C1.6 onwards) go in `shared`. Prisma enums (C1.2) must use the same values.
- **Error codes** are the problem `type`: `PROBLEM_TYPES` maps each code to `urn:testtix:problem:<code in kebab case>` (`VALIDATION_ERROR` → `urn:testtix:problem:validation-error`), and `errorCodeOf(type)` maps back. Error bodies don't get a separate `code` field; RFC 9457 already makes `type` the machine-readable identifier. Chunks add codes as they add errors, e.g. `QUEUE_REQUIRED` in C5.1.
- **Pipeline:** `pnpm openapi` runs a Turborepo task chain: build the API → `node dist/openapi/export-openapi.js` writes `apps/api/openapi.json` → `openapi-typescript` writes `apps/web/src/api/generated/openapi.ts`. The export boots Nest in **preview mode**, which resolves modules and routes without creating providers, so it needs no Postgres, Redis or env vars. A unit test checks that it matches what `GET /openapi.json` serves.
- **Both generated files are committed**, so building the web app doesn't depend on building the API, and API changes show up as spec diffs in review. Prettier and ESLint skip them. CI runs `pnpm openapi:check` (regenerate, then `git diff --exit-code`, plus a check for untracked files) and uploads `openapi.json` as the `openapi-spec` artifact.
- **Client:** `openapi-fetch` (`apps/web/src/api/client.ts`). It looks `fetch` up on each call so MSW, installed after import, still intercepts requests in tests. `unwrap()` returns the data or throws an `ApiError` with `status`, the parsed `problem` and its `code`.
- **`openapi-typescript` 7.13 declares a TypeScript `^5` peer.** It works with TS 6, and `pnpm.peerDependencyRules.allowedVersions` records the exception. Remove it once a release accepts TS 6.
- **Release note for C6.5:** the spec's `info.version` comes from `apps/api/package.json`. When release-please bumps the version, the release PR must update `openapi.json` too (as a release-please extra file, or by regenerating it), or the check fails.
- **Fixed in C0.7:** since C0.4, `components.schemas.ProblemDetails` had been emitted as a `$ref` to `#/definitions/ProblemDetails`, which doesn't exist in an OpenAPI document (`z.toJSONSchema` nests a schema that has an `id`). It's now generated in Zod's registry mode, and a unit test checks that every `$ref` in the spec resolves. `openapi-typescript` refused the old spec, which is how the bug surfaced.

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

**Data model (C1.2)**

- Models: `User`, `Session`, `Venue`, `Section` (`SEATED` with seats, or `GA` with a capacity), `Seat`, `Event`, `TicketBatch`, `InventoryUnit`, `Hold`, `Order`, `OrderItem`, `Ticket`, `PaymentEvent`. Seated and GA tickets are both `InventoryUnit` rows (one per sellable ticket, `seatId` null for GA), created when a batch is released; a batch's `releasesAt` keeps scheduled inventory off sale.
- **`Hold` is its own model** (added to the plan's list in C1.2): C3.1 needs hold IDs (`DELETE /holds/:id`, `POST /orders { holdId }`) and one hold per user and event (unique index). A unit points at its hold (`holdId`) and keeps a copy of the expiry (`heldUntil`), so a claim stays one conditional `UPDATE` on `inventory_units`.
- **Timestamps come from `ClockService`.** Columns are `timestamptz(3)` with no `now()` default and no `@updatedAt`: both would read the real time and ignore the test clock. The app passes `createdAt` / `updatedAt` explicitly.
- **CHECK constraints** that Prisma's schema can't express are appended by hand to the migration (GA capacity, `endsAt > startsAt`, non-negative prices, positive limits, lower-case emails, and "a unit is `HELD` exactly when it has a hold and an expiry"). Prisma Migrate ignores CHECK constraints, so later migrations don't drop them. Cross-table rules (a seat belongs to the unit's section, the section to the event's venue) are enforced by the app.
- Enum values live in `packages/shared` (`ROLES`, `EVENT_CATEGORIES`, `EVENT_STATUSES`, `SECTION_TYPES`, `INVENTORY_STATUSES`, `ORDER_STATUSES`); a unit test checks the Prisma enums match.
- Emails are stored lower-cased (CHECK constraint) rather than using `citext`.

**Seed (C1.2)**

- `apps/api/src/seed/`: named fixtures (`fixtures.ts`) plus 36 Faker-generated events (`generated-events.ts`, fixed Faker seed, curated band-name words so nothing looks like a real artist). `buildSeedData(now)` is a pure function; `seedDatabase(prisma, now)` inserts it in one transaction.
- **IDs:** `seedId(key)` derives a UUIDv7-shaped ID from SHA-256 of a stable key (`venue:riverside-hall`) with a fixed timestamp (2026-01-01), so fixture IDs can be documented and seed rows sort before app-created ones.
- **Dates are relative to the start of the UTC day of "now"** (from `ClockService`), so upcoming events stay upcoming whenever the seed runs, and any run on the same day gives identical data. The determinism test compares a per-table MD5 of every row (`src/testing/integration/data-hash.ts`).
- It refuses to run when venues or events exist (an advisory lock serializes concurrent runs) instead of mixing data sets. Faker is a runtime dependency, because the test API's reset (C1.3) reseeds inside the running API.
- `pnpm db:seed` runs `prisma db seed`, which runs the compiled CLI (`dist/seed/main.js`). Prisma 7's `migrate reset` no longer seeds, so a fresh start is `pnpm db:reset && pnpm db:seed`.

**Admin API (C2.1)**

- `VenuesModule` (`src/venues/`) and `EventsModule` (`src/events/`) hold the admin routes under `/admin/*`; both controllers carry `@Roles('ADMIN')`. The public catalogue (C2.2) adds its own controller to `EventsModule`.
- **Venue layouts are generated:** a seated section is `rows` × `seatsPerRow` (rows lettered from the front, as in the seed, which now shares `rowLabel()` from `src/venues/venue-layout.ts`); a GA section has a capacity. Limits (20 sections, 50 × 100 seats, 5000 GA, 20 000 per venue) keep one request from inserting millions of inventory rows. A layout can be replaced only while no inventory exists at the venue: inventory units reference seats and sections with `onDelete: Restrict`, so "no layout edits after sales" is enforced from the first released batch, not the first sale.
- **One lock per event:** every event change (edit, publish/unpublish/cancel, delete, batch release) runs in a transaction that starts with `SELECT … FOR UPDATE` on the event row (`lockEvent()`). Batch releases also take `FOR SHARE` on the venue row, which layout replacement and venue deletion lock `FOR UPDATE`. So concurrent releases can't release a seat twice or exceed a GA capacity, and a status check can't race a release. The unique `(event_id, seat_id)` index stays as the last line of defence.
- **Rules a schema can't check** (references to other rows, the current time, merged values of a PATCH) answer the same 400 `validation-error` as schema failures, via `validationFailed()` in `src/errors/problem.exception.ts`. State conflicts are 409 with their own problem types (`slug-taken`, `layout-locked`, `event-status-conflict`, …).
- **Slugs** are generated from the name or title (`slugify()` in `packages/shared`) and numbered when taken (`-2`, `-3`); `insertWithSlug()` (`src/infra/slugs.ts`) retries a generated slug on a unique violation, and maps a violation on a client-chosen slug to 409 `slug-taken`.
- **Ticket counts** are one grouped SQL query (`countUnits()`), counting `HELD` units with an expired `heldUntil` as available, matching the lazy hold expiry of C3.1.
- **Pagination** helpers (`PageQuerySchema`, `pageSchema()`, `toPage()`) live in `packages/shared`, so C2.2 reuses the same `page` / `pageSize` / `total` / `totalPages` shape.
- Not in C2.1: editing or deleting batches, and the drop settings (`waitingRoomEnabled`, admission rate), which arrive with C5.1.

**Public catalogue (C2.2)**

- `GET /events`, `GET /events/{slug}` (`CatalogueController` in `EventsModule`) and `GET /venues` (`VenuesController`) are `@Public()`. The query schema (`EventCatalogueQuerySchema`) and its enums (`EVENT_AVAILABILITIES`, `EVENT_SEATINGS`, `CATALOGUE_SORTS`) live in `packages/shared`, so the web list page (C2.3) can parse its URL query with the same rules.
- **One SQL derived table** (`src/events/catalogue-query.ts`) computes each published event's figures at the server clock (available released tickets, price range, seating, availability), so filters, sorts and the count all run in Postgres on the computed columns and pagination stays exact. Prisma's query builder can't filter or sort on aggregates; the raw SQL is built from `Prisma.sql` fragments (parameters only; the sort direction comes from a two-value enum).
- **Availability** is derived, never stored: `SALES_ENDED` once `startsAt` has passed, `SALES_NOT_OPEN` before `salesOpenAt` or the first batch release, then `SOLD_OUT` or `ON_SALE` by released tickets that are neither sold nor in an unexpired hold (lazy hold expiry, as in `countUnits()`). Public figures count released tickets only, unlike the admin counts; the price range covers all tickets so it doesn't move as tickets sell.
- **Seating** comes from the event's tickets (seats, GA places or both), not the venue layout: an event at a mixed venue that only sells the standing floor is `GA`.
- **Defaults:** the list starts at now (`from` defaults to the server clock), so past events need an explicit `from`; `GET /events/{slug}` shows past published events too. Date ranges are half-open (`from` ≤ `startsAt` < `to`).
- **Sorting:** `date`, `price` (lowest ticket price) or `name`, `asc` or `desc`; the start time and `id` tiebreakers stay ascending. Titles compare as `lower(title) COLLATE "C"`, so the order doesn't depend on the database's locale.
- **Search** is `ILIKE '%q%'` on title and performer with `%`, `_` and `\` escaped. Enough for the catalogue's size; full-text search (`tsvector`) is not needed in v1.
- `GET /venues` (venues with a published event) is an addition to the plan: the venue filter of C2.3 needs its choices, and the admin venue list needs the `ADMIN` role.

**Concurrency for "buying the last seat"**

- Seat claims use an atomic conditional update inside a Prisma interactive transaction, e.g. `UPDATE inventory_units SET status='HELD', hold_id=…, held_until=… WHERE id=… AND (status='AVAILABLE' OR held_until < now)`. If 0 rows were affected, the seat is already taken and the API returns 409.
- Order creation re-validates the hold in the same transaction.
- Later (not v1): a bug toggle `RACE_CONDITION_LAST_SEAT` switches to a naive read-then-write path so the race is reproducible.

### 3.2 Seat holds and time

- Holds live in Postgres (a `holds` row, plus `held_until` on each held inventory unit). A hold counts as expired when `held_until < clock.now()`, evaluated lazily on every read and write.
- A BullMQ job scheduler (repeatable job) sweeps expired holds for cleanup only. Correctness never depends on the sweeper (C3.2, see §3.3).
- **Injectable `ClockService`:** all server-side "now" goes through it. In test mode the clock can be frozen, set or advanced through the test API, so hold expiry is testable server-side and not just in the browser (Playwright's clock only covers the browser).
- Default hold duration is 10 minutes, configurable per event.

**Seat map and holds (C3.1)**

- `HoldsModule` (`src/holds/`): `GET /events/{eventId}/seats` (public) and `POST /events/{eventId}/holds`, `GET /holds/current`, `DELETE /holds/{holdId}`. The routes take the event ID (the plan's `:id`), not the slug. The seat map lists every section of the venue (the layout), with a `SeatStatus` per seat (`AVAILABLE`, `HELD`, `SOLD`, `NOT_ON_SALE`) and, per GA section, the claimable places grouped by price. It is not personalized, so it stays cacheable later. It is read in one `REPEATABLE READ` transaction so seats, GA counts and `availability` agree.
- **Expired means `held_until <= now`** (and held means `> now`), matching `countUnits()` and the catalogue SQL.
- **Locking order inside the hold transaction:** (1) `FOR SHARE` on the event row (holds run in parallel, but not with `lockEvent()`'s `FOR UPDATE` of admin changes such as unpublish); (2) a transaction-scoped advisory lock on `hold:<userId>:<eventId>`, so one user's requests for one event run one at a time and "a new hold replaces the old one" needs no unique-violation handling; (3) `SELECT … ORDER BY id FOR UPDATE` on the units that may have to be waited for (the user's previous hold and the requested seats), so concurrent requests take row locks in one global order and can't deadlock; (4) conditional `UPDATE`s that re-check claimability. GA places are picked with `ORDER BY price_cents, id LIMIT n FOR UPDATE SKIP LOCKED` (never waits) and then updated. `DELETE /holds/{id}` takes the same advisory lock and locks its units in ID order too.
- **All or nothing:** every conflict is collected, then one throw rolls back the whole transaction, including the release of the user's previous hold. So a failed request keeps the old hold.
- **GA takes the cheapest places first** (a section can have batches at different prices); hold items are ordered by section, row, seat, then price and ID.
- **409 bodies with data:** `ProblemException` takes extension members (RFC 9457 §3.2) that are spread under the standard ones. `tickets-unavailable` adds `unavailableSeatIds` and `gaShortfalls` (`TicketsUnavailableProblemSchema` in `packages/shared`, registered by `addProblemDetailsResponses()` and referenced by the route's documented 409). `event-not-on-sale` is a plain problem.
- **Validation order:** the body schema (shared `HoldRequestSchema`: 1–20 tickets, no duplicates), 404 unless published, 409 outside the sales window, then 400 for the event's `maxTicketsPerOrder` and for seats or GA sections not at the venue. Seats of the venue that the event doesn't sell (yet) are a 409, like taken seats: they may become available.
- Any logged-in user can hold; checkout (C4.2) will require a verified email.
- **Scenarios:** `ExtraRows` gained `holds` (inserted before inventory units). `hold-about-to-expire` returns a session for its holder (via `TestSessionsService.logIn()`), so UI tests can watch the countdown as the holder. `ga-meetup` splits its Floor into two price batches by post-processing the seed builder's rows. `one-seat-left` was extended with `soldSeats`, and every scenario event now reports `holdDurationSec`, `maxTicketsPerOrder` and `tickets.held`.

**ClockService (C1.1)**

- `ClockService.now()` is **async** (`await clock.now()`): in test mode it reads the clock state from Redis on every call, so a change made through one replica is seen by all of them at once, with no cache to invalidate. With test mode off it returns the real time without touching Redis. If Redis is down in test mode it throws instead of falling back to the real time, since a silently wrong clock would make tests lie.
- State is one Redis hash, `testtix:clock`, with `frozenAt` and/or `offsetMs` (epoch milliseconds). `frozenAt` wins. `advanceBy` is a Lua script that increments whichever field applies, so concurrent advances from different replicas all count.
- `advanceBy` is an integer number of milliseconds (1 to 366 days per call), not an ISO 8601 duration: easier to compute in test code, and no duration parser needed. Moving backwards is only possible by freezing at an earlier time.
- An ESLint rule (`no-restricted-syntax` in `apps/api/eslint.config.js`) bans `new Date()`, `Date()` and `Date.now()` in `apps/api/src` outside `clock.service.ts`, tests and the test harness. `new Date(value)` stays allowed.

### 3.3 Background jobs

| Area  | Decision                                                                                       | Status   |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| Queue | BullMQ on Redis (`@nestjs/bullmq`)                                                             | Proposed |
| Jobs  | payment confirmation handling, ticket generation + email, hold sweeper, waiting-room admission | Proposed |

**Worker and hold sweeper (C3.2)**

- `@nestjs/bullmq` 12 (its peer range includes Nest 11) with BullMQ 6. `JobsModule` (`src/jobs/`) sets the shared connection (`REDIS_URL`) and the key prefix `testtix:bull`. Queues and workers open their own Redis connections; the app's `REDIS` client stays separate.
- `WorkerModule` holds every processor and job schedule. The API imports it when `WORKER_IN_PROCESS=true` (the default). With `false`, run the worker as its own process: `node dist/worker.js` (`pnpm --filter @testtix/api start:worker`), an application context (`WorkerAppModule`: config, logs with `service: "worker"`, Postgres, Redis, clock, `WorkerModule`) with no HTTP. It ignores `WORKER_IN_PROCESS`.
- **Hold sweeper:** queue `hold-sweeper`, fed by a BullMQ job scheduler (`upsertJobScheduler`, the successor of repeatable jobs) with ID `sweep-expired-holds`, every `HOLD_SWEEPER_INTERVAL_MS` (default 60 s). Every worker process upserts it on startup, in the background with retries, so a process still starts while Redis is down. `HOLD_SWEEPER_ENABLED=false` removes the scheduler instead, so turning it off also stops a schedule an earlier deployment left in Redis.
- `HoldSweeperService.sweep()` reads expired holds (`expires_at <= now`, server clock) by keyset pagination and releases each one in its own transaction with the holds locking order (event `FOR SHARE` → the user's advisory lock → the hold's units by ID), then frees only the units still pointing at that hold and deletes it. It runs safely next to customers holding, replacing and releasing. The lock helpers live in `src/holds/hold-locks.ts`, shared with `HoldsService`.
- The test harnesses (`createTestApp()`, `createIntegrationApp()`) default to `WORKER_IN_PROCESS=false`, so no sweep runs at a moment a test doesn't expect; the sweeper tests turn it on. `POST /__test/reset` leaves the schedule alone: it holds no shop data, and the next sweep simply finds nothing to do.

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
- Implemented in C4.1 (NestJS on Fastify, like the API). Sessions and pending webhook deliveries are **in memory**: the provider is a test double, so a restart forgetting them is acceptable. The page is server-rendered HTML with no JavaScript.
- `POST /sessions` and `GET /sessions/:id` need `Authorization: Bearer <PAYMENTS_API_KEY>`, like a real provider's secret key; without it anyone could make the service POST to any URL. Webhook signature: `X-Payments-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">` with `X-Payments-Timestamp` (Unix seconds), re-signed on every attempt; retries back off exponentially without jitter, so they are predictable. The contract (schemas, header names) is in `packages/shared/src/payments.ts`.
- The receiver (API, C4.3) should check the replay window against the **real** time, not the controllable test clock: the provider's timestamps are real, so moving the API clock would otherwise reject every webhook.
- Its Dockerfile was written in C4.1 (compose runs it locally); C6.1 adds the api and web images.

### 3.7 Email

- Nodemailer over SMTP, sent to **Mailpit** locally and in the demo environment.
- Emails: account verification, order confirmation, e-ticket.
- **E-ticket [Decided]:** QR code in the email body **and** a PDF ticket attachment (one page per ticket, with QR, event, seat and order ID). QR via `qrcode`, PDF via `pdfkit`.
- Templates use Handlebars, with plain-text and HTML parts.

**Implementation notes (C1.5)**

- `MailModule` (`apps/api/src/mail/`): `MailService.send({ to, template, data })` renders and sends over SMTP with Nodemailer (`SMTP_URL`, a new connection per message, 10 s timeouts). Templates are typed: `MailTemplateData` lists each email and its variables.
- Templates live in `apps/api/templates/mail/` (`<name>.html.hbs`, `<name>.text.hbs`, plus a `layout.*.hbs` for each part), outside `src` so `src/` and `dist/` find them at the same relative path. They compile at startup in strict mode (a missing variable throws), HTML parts escape values and text parts don't. Prettier ignores `*.hbs`: its Handlebars formatter reflows the text parts.
- Sending is synchronous for now: the request waits for SMTP to accept the message. Order and ticket emails move to BullMQ jobs in M4. The `Date` header comes from `ClockService`.
- Verification links: one `email_verification_tokens` row per user (upserted, so a resend replaces the link and concurrent resends can't collide). Like sessions, the link carries 32 random bytes and the table stores their SHA-256. A used link stays valid as a no-op (people click twice) until replaced. Expiry is `EMAIL_VERIFICATION_TTL_HOURS` (default 24) on the server clock.
- Registration writes the user and the token in one transaction, then sends the email. A send failure is logged and doesn't fail the registration (the user can resend); a failed resend answers 503.
- `POST /auth/verify-email` is public (the link may open in another browser) but needs CSRF. `POST /auth/verify-email/resend` needs a session, so it can't be used to send email to arbitrary addresses. Per-user resend limits come with C5.3.
- New problem codes: `VERIFICATION_TOKEN_INVALID`, `VERIFICATION_TOKEN_EXPIRED` (both 400, so the web app can offer a resend for the second), `EMAIL_ALREADY_VERIFIED` (409).
- Integration tests: the harness starts Mailpit with Testcontainers (or uses `TEST_SMTP_URL` + `TEST_MAILPIT_URL`), and `waitForEmail(to, subject)` polls Mailpit's API. Mailpit is never emptied, so tests use unique recipients.

### 3.8 Auth and roles

| Area          | Decision                                                                                                           | Status   |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Login         | Email + password, hashed with argon2                                                                               | Proposed |
| Session       | HttpOnly, SameSite=Lax session cookie; sessions stored in Postgres                                                 | Proposed |
| Roles         | `CUSTOMER`, `ADMIN` (guards via Nest decorators)                                                                   | Proposed |
| CSRF          | Double-submit token for state-changing requests                                                                    | Proposed |
| Test shortcut | In test mode: `POST /__test/sessions` creates a user with a role and returns a session cookie, for API-based setup | Proposed |

**Implementation notes (C1.4)**

- Hashing: `@node-rs/argon2` (argon2id, library defaults 19 MiB / t=2 / p=1, the OWASP baseline). It ships prebuilt binaries as optional dependencies, so there is no install script for pnpm to block. `PasswordService.verify` never throws: an unknown email or a hash that doesn't parse (`!locked`) is checked against a dummy hash and answers like a wrong password, in about the same time.
- Sessions: `@fastify/cookie` parses and sets cookies. The cookie holds 32 random bytes (base64url); `sessions.token_hash` stores their SHA-256. Expiry is an idle timeout (`SESSION_TTL_HOURS`, default 168) from `ClockService`, moved forward at most once a minute, and the cookie's lifetime is `Max-Age`, never `Expires` (an absolute date from a frozen test clock would confuse browsers). `Secure` comes from `COOKIE_SECURE`, default on only in production.
- Guards: `AuthModule` registers two global guards. `AuthGuard` denies by default: routes without `@Public()` need a valid session (401), `@Roles(...)` routes a matching role (403). It loads the user on every request. `CsrfGuard` then checks the double-submit token (`X-CSRF-Token` header equal to the `testtix_csrf` cookie, compared in constant time) on every POST, PUT, PATCH and DELETE, anonymous ones included (login CSRF), except routes marked `@SkipCsrf()`. Test API controllers use `@TestApiController(path)`, which applies `@Public()` and `@SkipCsrf()`.
- The CSRF token is not bound to the session (plain double-submit, no server secret): enough on the single-host demo, where no sibling subdomain can plant cookies. Revisit with a signed token if the app ever shares a parent domain.
- OpenAPI: `@Public()` and `@SkipCsrf()` also leave `x-testtix-*` markers on operations; `addAuthDocs` turns them into the `session` cookie security requirement plus a 401, and the `X-CSRF-Token` header plus a 403, then removes the markers. The spec documents exactly what the guards enforce.
- Every 401 carries a `WWW-Authenticate` challenge (`ProblemDetailsFilter` adds `Session realm="testtix"` unless a guard set its own, like `TestKey`). New problem codes: `INVALID_CREDENTIALS`, `EMAIL_ALREADY_REGISTERED` (with a field error on `email`), `CSRF_TOKEN_INVALID`.
- The baseline seed has three accounts (admin, customer, unverified customer). Their argon2 hashes are constants with a fixed salt, so the seed stays deterministic; a unit test checks each matches its documented password.
- Login rate limiting is part of C5.3 (rate limits).

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

**Implementation notes (C1.1)**

- The test API is `TestApiModule` (`apps/api/src/test-api/`). `AppModule` imports it only in test mode, so outside test mode `/__test/*` is a plain 404 and none of its code runs.
- `TESTTIX_TEST_MODE` accepts only `true` or `false`. `TEST_API_KEY` must be at least 16 characters; `TestKeyGuard` compares SHA-256 digests with `timingSafeEqual` and sends `WWW-Authenticate: TestKey realm="test-api"` with its 401, as RFC 9110 requires. Endpoints opt in with `@RequiresTestKey()`, which also documents the header and the 401.
- The committed `openapi.json` is exported with test mode on, so it documents the test API (tag `test`). A server with test mode off serves a spec without those paths.

**Implementation notes (C1.3)**

- `POST /__test/reset` resets the clock first (or freezes it at an optional `freezeAt`), then truncates every table except `_prisma_migrations` and inserts the baseline seed for the clock's UTC day, all in **one transaction** (`resetAndSeedDatabase`). Other requests never see an empty database, a failure changes nothing, and the seed's advisory lock serializes concurrent resets and seeds. The body is optional, so `curl -X POST …/__test/reset` works; the optional `freezeAt` makes a reset fully reproducible (identical data hash). Later chunks clear their Redis state (queues, waiting rooms, rate limits) in `TestResetService` too.
- `POST /__test/seed/{scenario}` is **one route per scenario** (not a path parameter), so each documents its own response in OpenAPI and an unknown name is a plain 404. Scenarios are pure builders (`src/test-api/scenarios/scenarios.ts`) that reuse the seed's `buildCatalogue` and return the rows plus the response body; the service inserts the rows in one transaction.
- Scenarios are additive and isolated: each run creates its own small venue, events and buyer, with random UUIDv7 IDs (`uuidv7(now)`, timestamp from `ClockService`) and a random 8-hex suffix in every slug, title and email. They don't depend on the baseline, so they also work on an empty database.
- Sold inventory is backed by real data, as checkout will create it (C4): `CONFIRMED` orders of a scenario buyer (at most `maxTicketsPerOrder` items each), one order item and one ticket per unit. Buyers have the password hash `!locked`, which is not an argon2 hash, so nobody can log in as them; C1.4's login must treat a hash that doesn't parse as a wrong password, not a 500.
- Separate rate limiting and audit logging of `/__test/*` are deferred to C5.3 (TODO in `TestApiModule`).

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
