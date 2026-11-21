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

| Endpoint             | Needs `X-Test-Key` (when configured) |
| -------------------- | ------------------------------------ |
| `GET /__test/clock`  | no                                   |
| `POST /__test/clock` | yes                                  |

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
