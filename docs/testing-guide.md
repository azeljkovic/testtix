# TestTix testing guide

How to test TestTix from the outside: what the API promises, and the hooks it gives testers. This guide grows with each milestone; the test API, seed scenarios, test cards and the clock are added in M1–M5.

## Web app basics

- URL locally: `http://localhost:5173` (`pnpm --filter @testtix/web dev`). The page calls the API on its own origin under `/api` (`/api/health` → `GET /health`).
- Every page has the same landmarks: a header (`banner`) with the main navigation (`navigation` named "Main"), one `main` and a footer (`contentinfo`). The current navigation link has `aria-current="page"`.
- The first Tab stop is a "Skip to main content" link. Activating it moves focus to `main` without changing the URL.
- Each route sets the document title to `<page> · TestTix` (just `TestTix` on the home page). Unknown paths render a "Page not found" page with that title; the server still answers 200, since routing happens in the browser.
- Locate elements by role and accessible name. `data-testid` is only added where no good accessible locator exists.

## API basics

- Base URL locally: `http://localhost:3000` (`pnpm --filter @testtix/api dev`).
- OpenAPI 3 spec: `GET /openapi.json`. Swagger UI: `/docs`. Every operation documents its error response. The same spec is committed as `apps/api/openapi.json` and attached to every CI run as the `openapi-spec` artifact, so you can generate a client or contract checks without running the API.
- JSON in, JSON out. Money is integer cents, currency USD.
- Test-only endpoints live under `/__test/*` and are tagged `test` in the spec; see [Test mode](#test-mode).

## Request IDs

Every response has an `X-Request-Id` header. Send your own (1–128 characters from `A-Z a-z 0-9 . _ : -`) to correlate a test step with server logs; anything else is replaced with a generated UUID. The ID appears as `req.id` in the API's JSON log lines and as `requestId` in error bodies.

```sh
curl -i -H 'X-Request-Id: checkout-test-42' http://localhost:3000/health
```

## Error format

Every error response, whatever the cause, is `application/problem+json` (based on [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "urn:testtix:problem:validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request is invalid. See `errors` for each problem.",
  "instance": "/auth/register",
  "requestId": "checkout-test-42",
  "errors": [{ "path": "email", "code": "invalid_format", "message": "Invalid email address" }]
}
```

| Field       | Meaning                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `type`      | `about:blank` when the HTTP status says it all; a `urn:testtix:problem:*` URI for app-specific problems  |
| `title`     | Short summary of the type (the HTTP status phrase for `about:blank`)                                     |
| `status`    | Same as the HTTP status code                                                                             |
| `detail`    | Explanation of this occurrence. For 5xx it is always the generic `An unexpected error occurred.`         |
| `instance`  | Request path, without the query string                                                                   |
| `requestId` | Same as the `X-Request-Id` header                                                                        |
| `errors`    | Field errors for validation failures (`path` is dot-separated, e.g. `items.0.quantity`); otherwise empty |

Branch on `type`, never on `title` or `detail`. App-specific types end in an error code in kebab case: `urn:testtix:problem:validation-error` is the code `VALIDATION_ERROR` (the codes live in `packages/shared/src/problems.ts`).

Problem types so far:

| `type`                                 | Status | When                                                                                |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `about:blank`                          | any    | Unknown route (404), malformed JSON (400), missing or wrong `X-Test-Key` (401), 5xx |
| `urn:testtix:problem:validation-error` | 400    | Body, query or path parameters fail validation                                      |

## Health and readiness

| Endpoint            | 200 when                               | Otherwise                                   |
| ------------------- | -------------------------------------- | ------------------------------------------- |
| `GET /health`       | the process can serve requests         | no response at all                          |
| `GET /health/ready` | Postgres and Redis both answer in time | 503, same body, the failing check is `down` |

```json
{ "status": "error", "checks": { "database": { "status": "up" }, "redis": { "status": "down" } } }
```

Each check times out after `HEALTH_CHECK_TIMEOUT_MS` (default 1000 ms). Right after the API starts, Redis can report `down` for a moment until its connection is established. To try the 503 path locally, stop Redis with `docker compose --project-directory . -f docker/compose.yml stop redis`, then start it again with `pnpm infra:up`. The API reconnects on its own.

Wait for readiness before a test run instead of sleeping:

```sh
until curl -sf http://localhost:3000/health/ready > /dev/null; do sleep 1; done
```

## Test mode

Test mode gives testers hooks that a real shop would never expose: the test API under `/__test/*` and a server clock you can control. Turn it on with `TESTTIX_TEST_MODE=true` (`.env.example` sets it, so a local `.env` copied from it has test mode on; without a `.env` it is off). With test mode off, every `/__test/*` path answers 404 like any unknown route, and the clock is always the real time.

On startup the API logs a `TestMode` warning saying whether test mode is on and whether the test API is key-protected.

### Test API key

Some test endpoints affect everyone using the server: freezing the clock or wiping the data breaks every other tester's session on a shared instance such as the hosted demo. When the server sets `TEST_API_KEY` (at least 16 characters), those endpoints require the same value in an `X-Test-Key` header and answer 401 without it (with a `WWW-Authenticate` header). When `TEST_API_KEY` is unset, as it is locally, they are open.

| Endpoint                       | Needs `X-Test-Key` (when configured) |
| ------------------------------ | ------------------------------------ |
| `GET /__test/clock`            | no                                   |
| `POST /__test/clock`           | yes                                  |
| `POST /__test/reset`           | yes                                  |
| `POST /__test/seed/{scenario}` | no (it only adds data)               |

### The server clock

All server-side time (hold expiry, session expiry, ticket drops) comes from one clock. In test mode you can freeze it, move it forward or reset it, so time-dependent behaviour is testable through the API instead of by waiting. The clock state lives in Redis, so every API instance and background worker sees the same time.

The clock only changes server time. Browser time is separate: in UI tests, control it with your browser tool (for example Playwright's `page.clock`) as well.

`GET /__test/clock` reads it, and `POST /__test/clock` changes it and returns the result. Both return:

```json
{ "now": "2026-12-01T18:30:00.000Z", "mode": "frozen", "offsetMs": 856800000 }
```

| Field      | Meaning                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- |
| `now`      | Server time, ISO 8601 in UTC with milliseconds                                               |
| `mode`     | `real`: the real time. `frozen`: stopped at `now`. `offset`: running, shifted forward        |
| `offsetMs` | `now` minus the real time, in milliseconds. 0 in `real` mode, negative if frozen in the past |

The `POST` body holds exactly one of these (anything else is a 400 `validation-error`, as are unknown fields):

| Body                                     | Effect                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "freezeAt": "2026-12-01T19:30:00Z" }` | Stop the clock at that time, in the past or future. The time needs `Z` or an offset (`+01:00`). It replaces any earlier freeze or offset                                |
| `{ "advanceBy": 600000 }`                | Move forward by that many milliseconds (an integer from 1 to 31 622 400 000, i.e. 366 days). A frozen clock stays frozen at the later time; a running one keeps running |
| `{ "reset": true }`                      | Back to the real time                                                                                                                                                   |

The clock never moves backwards on its own: `advanceBy` only accepts positive values. To go back, freeze at an earlier time or reset. Concurrent `advanceBy` calls all count, even when they reach different API instances.

```sh
# Freeze, then jump 10 minutes ahead (e.g. past a seat hold's expiry)
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -d '{"freezeAt":"2026-12-01T19:30:00Z"}'
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -d '{"advanceBy":600000}'
# → {"now":"2026-12-01T19:40:00.000Z","mode":"frozen",...}

# Back to real time; add the key on a server that has one
curl -s -X POST http://localhost:3000/__test/clock -H 'Content-Type: application/json' \
  -H "X-Test-Key: $TEST_API_KEY" -d '{"reset":true}'
```

The clock is global to the server: reset it when your test is done, and don't run tests that change it in parallel against the same server.

## Seed data

The baseline data set (`pnpm db:seed` on an empty database, or [`POST /__test/reset`](#resetting-the-data) at any time) has four venues, eight named fixture events and 36 generated ones. It is deterministic: seeding twice gives identical rows, and every slug and ID below is the same on every machine and every run.

Dates are relative to the **seed day**: the UTC date of the server clock when the seed ran (so with a frozen test clock, the frozen date). Below, `D+21 23:30` means 21 days after the start of that day, at 23:30 UTC. Seeding at any time on the same day gives the same dates; seeding on another day shifts every date but keeps every ID. Venues are in the fictional city of Port Ellis (time zone `America/New_York`).

The baseline has no users, holds or orders: every ticket is `AVAILABLE`. (Seeded accounts arrive with sign-in in C1.4.)

### Venues

| Slug                | ID                                     | Layout                                                              |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `riverside-hall`    | `019b76da-a800-7fbc-a24e-2ac58eab7ced` | Seated: Stalls (rows A–J × 20 seats), Balcony (rows A–D × 16)       |
| `the-warehouse`     | `019b76da-a800-7664-aea7-0601ec1983ba` | Mixed: Standing Floor (GA, capacity 250), Mezzanine (rows A–C × 12) |
| `harbor-auditorium` | `019b76da-a800-7501-8b17-e21d3d3d2902` | Seated: Main Floor (rows A–H × 14)                                  |
| `loft-23`           | `019b76da-a800-7258-bef4-ba77cca0deac` | GA: Loft (capacity 60)                                              |

Seat rows are lettered from the front (`A`), and seats are numbered from 1 within a row.

### Fixture events

| Slug                               | ID                                     | Status, starts        | What it's for                                                                                      |
| ---------------------------------- | -------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `midnight-echoes-live`             | `019b76da-a800-7758-9ad4-dec842184578` | Published, D+21 23:30 | Seated concert. Stalls on sale at $89.00; the Balcony batch ($59.00) is only released at D+3 15:00 |
| `warehouse-sessions-static-lights` | `019b76da-a800-776b-a16b-343f20473dbe` | Published, D+10 00:00 | Mixed seated + GA: Standing $45.00 (250 GA tickets), Mezzanine $75.00 (36 seats)                   |
| `testing-in-production-safely`     | `019b76da-a800-7913-96f9-35b2f7f50dd5` | Published, D+7 23:00  | Talk, 112 seats at $25.00                                                                          |
| `flaky-tests-clinic`               | `019b76da-a800-709a-8e78-794ac8523db8` | Published, D+7 23:00  | GA meetup, 60 tickets at $10.00. Starts at the same time as the talk above (sort tiebreaker)       |
| `summer-sounds-preview`            | `019b76da-a800-76de-b7e6-667e253a5e53` | Published, D+60 23:00 | Not on sale yet: sales open at D+14 15:00                                                          |
| `season-opener-showcase`           | `019b76da-a800-748c-b62b-9a1a51bcaaa8` | Published, D−7 23:00  | Already happened (sales opened at D−60 15:00)                                                      |
| `unannounced-headliner`            | `019b76da-a800-7fdf-8a97-784175aa9759` | Draft, D+45 23:30     | Not in the public catalogue; no tickets released                                                   |
| `acoustic-night-cancelled`         | `019b76da-a800-7e6d-8fd4-edb91a27a3cb` | Cancelled, D+3 23:30  | Cancelled event                                                                                    |

Unless noted, sales opened at D−30 15:00, and every batch puts all seats (or GA places) of its sections on sale.

### Generated events

36 more published events, on sale since D−14 15:00, fill the catalogue for pagination, filters and search. Faker generates them with a fixed seed: concerts by made-up bands at Riverside Hall or The Warehouse, talks at Harbor Auditorium and meetups at Loft 23, starting between D+1 and D+90. Their slugs end in a number (`the-neon-owls-live-4`) and are stable too, but prefer the fixtures above in tests: the generated list may change when the seed is extended.

## Resetting the data

`POST /__test/reset` puts the server back into its baseline state in one call:

1. It resets the server clock to the real time, or freezes it at `freezeAt` if the body has one.
2. It deletes every row (users, sessions, holds, orders and scenario data included) and inserts the [baseline seed](#seed-data) for the clock's UTC date.

The data swap is one database transaction: while it runs, other requests wait or see the old data, never an empty or half-seeded database. Concurrent resets run one after the other. On a server with a [test API key](#test-api-key) it needs `X-Test-Key`.

The body is optional. Send none (or `{}`) to reset the clock, or `{ "freezeAt": "<ISO date-time>" }` (with `Z` or an offset) to freeze it. Resetting twice with a `freezeAt` on the same UTC day gives identical data, dates included; without it, the dates follow the real date. Unknown fields are a 400 `validation-error`.

```sh
curl -s -X POST http://localhost:3000/__test/reset
curl -s -X POST http://localhost:3000/__test/reset -H 'Content-Type: application/json' \
  -d '{"freezeAt":"2026-12-01T10:00:00Z"}'
```

```json
{
  "seedDay": "2026-12-01",
  "clock": { "now": "2026-12-01T10:00:00.000Z", "mode": "frozen", "offsetMs": 842070954 },
  "rows": {
    "venues": 4,
    "sections": 6,
    "seats": 412,
    "events": 44,
    "ticketBatches": 56,
    "inventoryUnits": 6370
  }
}
```

`seedDay` is `D` in the [fixture tables](#fixture-events). `rows` counts what was inserted; every other table is empty.

Run it before a test suite (or each test that needs the baseline), not in parallel with other tests against the same server: it logs everyone out and removes their data.

## Seed scenarios

`POST /__test/seed/{scenario}` adds a ready-made situation that the baseline doesn't have and answers 201 with the IDs it created. Scenarios only **add** rows: each call creates its own venue, events and (where needed) a buyer and orders, with fresh IDs. Every slug and title ends in a random 8-character suffix, so calls never collide, existing data isn't touched, and parallel tests can each create their own data. That is also why scenarios stay open on a server with a test API key.

Scenario data stays until the next reset. It is real data: scenario events are published and appear in the public catalogue next to the baseline. To find just your run's events, search for its suffix.

Dates are relative to the clock's UTC day (`D`), like the baseline: every scenario event has been on sale since D−1 15:00 and starts at D+7 to D+14, at 23:00 UTC. Rows get `createdAt` = the server clock. Unknown scenario names answer 404.

| Scenario          | Creates                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic-catalogue` | A venue with Seats (rows A–C × 6) and Standing (GA, capacity 20), and three published events on sale: a concert using both ($40.00 seats, $25.00 standing), a seated talk ($15.00) and a GA meetup ($5.00) |
| `sold-out-event`  | A published concert on sale whose 12 tickets (Seats rows A–B × 4 at $50.00, Standing GA capacity 4 at $30.00) are all sold, through confirmed orders of a new buyer (at most 6 tickets per order)          |
| `one-seat-left`   | A published concert on sale with 8 seats (rows A–B × 4, $45.00); all are sold through confirmed orders except row B seat 4                                                                                 |

Buyers are customers with a verified email `buyer-<suffix>@scenario.testtix.test` and no usable password: nobody can log in as them. Their orders are `CONFIRMED` and every sold ticket has a ticket code.

```sh
curl -s -X POST http://localhost:3000/__test/seed/one-seat-left
```

Every response has a `venue` (ID, slug, name and sections with their IDs) and the events, each with its ID, slug, title, category, status, `startsAt`, `salesOpenAt` and a ticket count by status:

```json
{
  "venue": {
    "id": "019ac6b2-…",
    "slug": "scenario-venue-3f9a1c2b",
    "name": "Scenario Venue 3f9a1c2b",
    "sections": [{ "id": "019ac6b2-…", "name": "Seats", "type": "SEATED", "capacity": null }]
  },
  "event": {
    "id": "019ac6b2-…",
    "slug": "one-seat-left-3f9a1c2b",
    "title": "One Seat Left 3f9a1c2b",
    "category": "CONCERT",
    "status": "PUBLISHED",
    "venueId": "019ac6b2-…",
    "startsAt": "2026-12-05T23:00:00.000Z",
    "salesOpenAt": "2026-11-20T15:00:00.000Z",
    "tickets": { "total": 8, "available": 1, "sold": 7 }
  },
  "buyer": { "id": "019ac6b2-…", "email": "buyer-3f9a1c2b@scenario.testtix.test" },
  "orderIds": ["019ac6b2-…", "019ac6b2-…"],
  "seat": {
    "id": "019ac6b2-…",
    "sectionId": "019ac6b2-…",
    "row": "B",
    "number": 4,
    "inventoryUnitId": "019ac6b2-…",
    "priceCents": 4500
  }
}
```

| Scenario          | Response fields                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `basic-catalogue` | `venue`, `events.concert`, `events.talk`, `events.meetup`                                 |
| `sold-out-event`  | `venue`, `event`, `buyer`, `orderIds`                                                     |
| `one-seat-left`   | `venue`, `event`, `buyer`, `orderIds`, `seat` (the available seat and its inventory unit) |

The OpenAPI spec documents each response in full. Later milestones add scenarios (holds about to expire, GA last tickets, confirmed orders, ticket drops).
