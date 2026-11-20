# TestTix testing guide

How to test TestTix from the outside: what the API promises, and the hooks it gives testers. This guide grows with each milestone; the test API, seed scenarios, test cards and the clock are added in M1–M5.

## API basics

- Base URL locally: `http://localhost:3000` (`pnpm --filter @testtix/api dev`).
- OpenAPI 3 spec: `GET /openapi.json`. Swagger UI: `/docs`. Every operation documents its error response.
- JSON in, JSON out. Money is integer cents, currency USD.

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

Problem types so far:

| `type`                                 | Status | When                                           |
| -------------------------------------- | ------ | ---------------------------------------------- |
| `about:blank`                          | any    | Unknown route (404), malformed JSON (400), 5xx |
| `urn:testtix:problem:validation-error` | 400    | Body, query or path parameters fail validation |

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
