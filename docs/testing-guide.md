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

| `type`                                           | Status | When                                                                                                                                                                   |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about:blank`                                    | any    | Unknown route (404), malformed JSON (400), not logged in or session expired (401), missing or wrong `X-Test-Key` (401), logged in without the required role (403), 5xx |
| `urn:testtix:problem:validation-error`           | 400    | Body, query or path parameters fail validation                                                                                                                         |
| `urn:testtix:problem:invalid-credentials`        | 401    | Login with a wrong email or password                                                                                                                                   |
| `urn:testtix:problem:csrf-token-invalid`         | 403    | A POST, PUT, PATCH or DELETE without a valid `X-CSRF-Token` header (see [CSRF](#csrf-tokens))                                                                          |
| `urn:testtix:problem:email-already-registered`   | 409    | Registering an email that already has an account (`errors[0].path` is `email`)                                                                                         |
| `urn:testtix:problem:verification-token-invalid` | 400    | [Verifying an email](#email-verification) with an unknown or malformed token, or one replaced by a newer email                                                         |
| `urn:testtix:problem:verification-token-expired` | 400    | Verifying an email with an unused link past its expiry                                                                                                                 |
| `urn:testtix:problem:email-already-verified`     | 409    | Asking for a new verification email when the address is already verified                                                                                               |

## Accounts and sessions

Accounts log in with email and password. A login session is a cookie; there are no bearer tokens.

| Endpoint                         | Auth           | What it does                                                                                                                                  |
| -------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/csrf`                 | none           | Sets the CSRF cookie and returns its token: `{ "csrfToken": "…" }`                                                                            |
| `POST /auth/register`            | CSRF           | `{ email, password, name }` → 201, creates a customer (email unverified), sends it a [verification email](#email-verification) and logs it in |
| `POST /auth/login`               | CSRF           | `{ email, password }` → 200, logs in                                                                                                          |
| `POST /auth/logout`              | CSRF           | 204. Ends the session and clears the cookie. Also 204 without a session, so it is safe to repeat                                              |
| `GET /auth/me`                   | session        | 200 with the user and session, 401 without a valid session                                                                                    |
| `POST /auth/verify-email`        | CSRF           | `{ token }` → 204, verifies the email address of the token's account (see [Email verification](#email-verification))                          |
| `POST /auth/verify-email/resend` | session + CSRF | 204, emails the logged-in user a new verification link                                                                                        |

Register, login and `me` answer with the user and the session expiry:

```json
{
  "user": {
    "id": "019b76da-a800-7599-864c-1d5467501b78",
    "email": "customer@testtix.test",
    "name": "Casey Customer",
    "role": "CUSTOMER",
    "emailVerified": true,
    "createdAt": "2026-08-23T12:00:00.000Z"
  },
  "session": { "expiresAt": "2026-11-28T18:40:00.000Z" }
}
```

**Validation.** Emails are trimmed and lower-cased, so `  Ada@Example.COM` and `ada@example.com` are the same account (max 254 characters). Passwords are 8–128 characters, used exactly as typed (spaces count). Names are 1–100 characters after trimming. Unknown fields, such as `role`, are a 400: registration always creates a `CUSTOMER`. Login only checks that the password isn't empty.

**Wrong credentials.** A wrong password, an unknown email and an account without a usable password (such as a [scenario buyer](#seed-scenarios)) all get the same 401 `invalid-credentials`, with the same body and roughly the same response time, so the API doesn't reveal which emails are registered. Registration does reveal it (409 `email-already-registered`); that's a deliberate usability trade-off.

### Session cookie

Register and login set `testtix_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, with `Max-Age` = the session TTL, and `Secure` when the server sets `COOKIE_SECURE=true` (the default with `NODE_ENV=production`). The cookie holds a random token; the server stores only its SHA-256 hash in the `sessions` table. Logging in or registering ends the session the request came with, so a browser holds one session at a time. Several browsers (or API clients) can each have their own session for the same account.

- **Expiry is an idle timeout** of `SESSION_TTL_HOURS` (default 168, i.e. 7 days), measured by the [server clock](#the-server-clock). Every authenticated request moves the expiry to now + TTL, at most once a minute, and re-sends the cookie when it does. `session.expiresAt` in `GET /auth/me` shows the current value.
- At `expiresAt` the session is over: the next request answers 401, deletes the session row and clears the cookie. To test it, freeze the clock, log in, then `advanceBy` the TTL (604 800 000 ms by default).
- A request with an unknown, ended or malformed session cookie gets 401 and a `Set-Cookie` that clears it.
- Lifetimes are sent as `Max-Age`, never `Expires`, so a frozen or moved server clock doesn't confuse browsers. Browsers count `Max-Age` in real time, though: after advancing the server clock past the TTL, the browser still sends the cookie and the server rejects it.
- Every 401 carries `WWW-Authenticate: Session realm="testtix"`. A valid session without the required role gets 403 (`about:blank`). The user is loaded on every request, so a role change or a deleted account takes effect immediately.

### CSRF tokens

Every POST, PUT, PATCH and DELETE request (login and register included, the test API excluded) must send an `X-CSRF-Token` header equal to the `testtix_csrf` cookie, or it gets 403 `csrf-token-invalid`. This is the double-submit pattern: another site can make a browser send the cookie but can't read it, so it can't set the header.

1. `GET /auth/csrf` sets `testtix_csrf` (readable by scripts, `SameSite=Lax`, 30 days) and returns the same token. Calling it again returns the existing token and renews the cookie.
2. Send the cookie and the header on every state-changing request. The token doesn't change on login or logout.

On a route that needs a session, a request without one gets 401 before the CSRF check, so the order is: 401 (no session) → 403 (CSRF) → 403 (role) → 400 (validation).

```sh
jar=$(mktemp)
token=$(curl -s -c "$jar" http://localhost:3000/auth/csrf | jq -r .csrfToken)
curl -s -b "$jar" -c "$jar" -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $token" \
  -d '{"email":"customer@testtix.test","password":"TestTix-customer-1"}'
curl -s -b "$jar" http://localhost:3000/auth/me
curl -s -b "$jar" -c "$jar" -X POST http://localhost:3000/auth/logout -H "X-CSRF-Token: $token"
```

For API-based test setup, [`POST /__test/sessions`](#logging-in-through-the-test-api) skips all of this and returns a ready session.

## Email

The API sends email over SMTP (`SMTP_URL`). Locally that is [Mailpit](https://mailpit.axllent.org), which catches every message: read them in the inbox at <http://localhost:8025>, or through Mailpit's API from tests.

- Every email has an HTML and a plain-text part, `From` is `MAIL_FROM` (default `TestTix <no-reply@testtix.test>`), and links point at the web app (`WEB_BASE_URL`, default `http://localhost:5173`).
- The `Date` header follows the [server clock](#the-server-clock), so an email sent while the clock is frozen carries the frozen time.
- Email is sent while the request is handled: when the request returns, Mailpit has the message. Still poll instead of reading once, since email that comes from background jobs (order confirmation, tickets, from M4) arrives later.

```sh
# The newest verification email to an address (needs jq)
curl -s 'http://localhost:8025/api/v1/search?query=to:"ada@example.com" subject:"Verify your email address"' \
  | jq -r '.messages[0].ID' \
  | xargs -I{} curl -s http://localhost:8025/api/v1/message/{} | jq -r .Text
```

Mailpit's search matches substrings and returns the newest message first. Use a unique recipient per test (Mailpit is shared, and old messages stay until it drops them at 1000), and check the exact address and subject in the result.

### Email verification

Registering sends **Verify your email address** with a link to `<WEB_BASE_URL>/verify-email?token=<token>`. The token is 43 URL-safe characters; the server stores only its SHA-256 hash. Unverified users can log in, but can't check out (from M4).

1. Read the email and take the `token` query parameter from the link.
2. `POST /auth/verify-email` with `{ "token": "…" }` → 204. It needs a CSRF token but no session, so the link works in any browser. `GET /auth/me` now shows `"emailVerified": true`.

Rules worth testing:

| Situation                                                        | Result                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The same link used again                                         | 204, no change: the first verification time stays                                                                                                |
| An unused link after `EMAIL_VERIFICATION_TTL_HOURS` (default 24) | 400 `verification-token-expired`. To test it, freeze the clock, register, then `advanceBy` 86 400 000 ms. One millisecond earlier it still works |
| A link from an older email, after a resend                       | 400 `verification-token-invalid`: only the newest link works                                                                                     |
| An unknown or malformed token                                    | 400 `verification-token-invalid`; an empty token is a 400 `validation-error`                                                                     |
| `POST /auth/verify-email/resend` without a session               | 401                                                                                                                                              |
| Resend for an already verified user                              | 409 `email-already-verified`, nothing is sent                                                                                                    |
| The SMTP server is down                                          | Registration still succeeds (the account exists, unverified, and the failure is logged); resend answers 503                                      |

A resend issues a new link with a fresh expiry and emails it. There is no resend limit yet (rate limits come in M5).

Users from [`POST /__test/sessions`](#logging-in-through-the-test-api) with `"emailVerified": false` get no email; call the resend endpoint with their session to get one. [Seeded](#seeded-accounts) `unverified@testtix.test` has no link either until it asks for one.

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
| `POST /__test/sessions`        | no (it only adds data)               |

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

The baseline has three [accounts](#seeded-accounts) and no holds or orders: every ticket is `AVAILABLE`.

### Seeded accounts

| Email                     | Password               | ID                                     | Role       | Email verified |
| ------------------------- | ---------------------- | -------------------------------------- | ---------- | -------------- |
| `admin@testtix.test`      | `TestTix-admin-1`      | `019b76da-a800-788e-b36d-87227a4e2df8` | `ADMIN`    | yes            |
| `customer@testtix.test`   | `TestTix-customer-1`   | `019b76da-a800-7599-864c-1d5467501b78` | `CUSTOMER` | yes            |
| `unverified@testtix.test` | `TestTix-unverified-1` | `019b76da-a800-78a5-9bed-edb1c9007204` | `CUSTOMER` | no             |

They are shared by everyone using the server: on a shared instance, prefer [`POST /__test/sessions`](#logging-in-through-the-test-api) or a registration with a unique email, so tests don't log each other out or change each other's data.

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
    "users": 3,
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

## Logging in through the test API

`POST /__test/sessions` creates a new user with a role and logs it in, in one call: API tests and UI tests that only need "a logged-in admin" skip registration, CSRF and login. Like the scenarios it only adds data, so it stays open on a server with a test API key, and it is exempt from the CSRF check.

| Field           | Required | Default                                          | Meaning                                                                                       |
| --------------- | -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `role`          | yes      |                                                  | `CUSTOMER` or `ADMIN`                                                                         |
| `email`         | no       | `user-<random>@session.testtix.test`             | Normalized like registration. 409 `email-already-registered` if it is taken                   |
| `name`          | no       | `Test Customer <random>` / `Test Admin <random>` |                                                                                               |
| `password`      | no       | none                                             | 8–128 characters. Lets the user also log in through `POST /auth/login` (e.g. a login UI test) |
| `emailVerified` | no       | `true`                                           | `false` gives an unverified user, who can log in but not check out                            |

Without `password` the user has no usable password: the returned session is the only way in. The call answers 201, sets the `testtix_session` and `testtix_csrf` cookies, and returns the same values in the body, plus a ready-made `Cookie` header for clients without a cookie jar:

```sh
session=$(curl -s -X POST http://localhost:3000/__test/sessions \
  -H 'Content-Type: application/json' -d '{"role":"ADMIN"}')
curl -s http://localhost:3000/auth/me -H "Cookie: $(echo "$session" | jq -r .cookie)"
```

```json
{
  "user": {
    "id": "019ac6b2-…",
    "email": "user-3f9a1c2b@session.testtix.test",
    "name": "Test Admin 3f9a1c2b",
    "role": "ADMIN",
    "emailVerified": true,
    "createdAt": "…"
  },
  "session": { "token": "…", "expiresAt": "2026-11-28T18:40:00.000Z" },
  "csrfToken": "…",
  "cookie": "testtix_session=…; testtix_csrf=…"
}
```

On state-changing requests, send `cookie` as the `Cookie` header and `csrfToken` as `X-CSRF-Token`. The session behaves like any other: it expires with the [server clock](#session-cookie), and `POST /auth/logout` ends it.
