# Hosted demo

How the public TestTix demo runs: one server with Docker Compose, deployed by GitHub Actions from the images CI publishes, and reset every night. For testers, the addresses and rules are in the [testing guide](testing-guide.md#hosted-demo).

## Layout

The server runs the `full` compose profile (see the [README](../README.md#running-everything-in-containers)) with the registry images, plus the overlay `docker/demo/compose.yml`. The overlay adds `edge`, a Caddy that is the only thing listening publicly (ports 80 and 443). It gets Let's Encrypt certificates for four host names under `DEMO_DOMAIN` and redirects HTTP to HTTPS:

| Address                    | Serves                                                         | Behind `edge`                            |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `https://DEMO_DOMAIN`      | the web app, with the API under `/api`                         | `web:8080`                               |
| `https://api.DEMO_DOMAIN`  | the API, at the same paths as `http://localhost:3000` locally  | `web:3000`, spread over the API replicas |
| `https://pay.DEMO_DOMAIN`  | the fake provider's payment page (`/pay/*` and its stylesheet) | `fake-payments:4000`                     |
| `https://mail.DEMO_DOMAIN` | Mailpit's UI and API, behind a login (`MAILPIT_UI_AUTH`)       | `mailpit:8025`                           |

What stays private: `/metrics` (on both API addresses), the provider's API (`/sessions`, `/health`), Mailpit without its login, the test API's reset and clock without `X-Test-Key`, and every other container port (they bind to `127.0.0.1` on the server). The observability profile doesn't run on the demo: Grafana has no login. To watch the demo, run Prometheus locally and point `docker/observability/prometheus/targets-*.yml` at an SSH tunnel.

Differences from a local `pnpm full:up`, all in the overlay:

- `COOKIE_SECURE=true`, `WEB_BASE_URL=https://DEMO_DOMAIN` (links in emails), the provider's `PUBLIC_BASE_URL=https://pay.DEMO_DOMAIN`.
- `TEST_API_KEY`, `LOAD_TEST_KEY`, `PAYMENTS_API_KEY`, `PAYMENTS_WEBHOOK_SECRET`, `POSTGRES_PASSWORD` and `MAILPIT_UI_AUTH` must be set: compose refuses to start without them.
- `edge` writes the client's address into `X-Forwarded-For` (replacing whatever the client sent) and the web image's Caddy keeps it (`TRUSTED_PROXIES=private_ranges`), so rate limits and the test API audit log see real clients.

The sibling hosts share the shop's parent domain, so they could set cookies the shop receives (the CSRF cookie is a plain double-submit token, see tech-stack §3.8). They serve only TestTix's own code and Mailpit, which shows email HTML in a sandbox without scripts, and Mailpit's SMTP port isn't public. Don't host anything else under `DEMO_DOMAIN`.

## Setting up the server

Once, by hand:

1. **A VPS** with a public IPv4 address (start at about 4 vCPU / 8 GB, tech-stack §6), Docker Engine with the Compose plugin, and a deploy user in the `docker` group with an SSH key login. Open ports 22, 80 and 443 (443/udp too, for HTTP/3) and nothing else.
2. **DNS:** `A` (and `AAAA` if the server has IPv6) records pointing at the server for `DEMO_DOMAIN`, `api.`, `pay.` and `mail.` under it (or a wildcard `*.DEMO_DOMAIN` next to the bare name). Caddy can only get certificates once they resolve.
3. **GHCR packages public:** in GitHub, open each package (`testtix/api`, `testtix/web`, `testtix/fake-payments`) → Package settings → Change visibility → Public. The server pulls without a token.
4. **A GitHub environment `demo`** (Settings → Environments), with deployment branches limited to `main` (and the release tags, from C6.4). Don't add required reviewers: the nightly reset uses it too. Its secrets:

   | Secret                    | Value                                                                                   |
   | ------------------------- | --------------------------------------------------------------------------------------- |
   | `DEMO_SSH_HOST`           | the server's address                                                                    |
   | `DEMO_SSH_USER`           | the deploy user                                                                         |
   | `DEMO_SSH_PRIVATE_KEY`    | a private key for that user, used only by the workflows                                 |
   | `DEMO_SSH_KNOWN_HOSTS`    | the server's host keys: `ssh-keyscan <host>`, checked against the server's fingerprints |
   | `POSTGRES_PASSWORD`       | letters and digits only (it goes into a URL)                                            |
   | `TEST_API_KEY`            | at least 16 characters; share it only with people who may reset the demo                |
   | `LOAD_TEST_KEY`           | at least 16 characters; for authorised k6 runs (tests repo)                             |
   | `PAYMENTS_API_KEY`        | at least 16 characters                                                                  |
   | `PAYMENTS_WEBHOOK_SECRET` | at least 16 characters                                                                  |
   | `MAILPIT_UI_AUTH`         | `user:password` for Mailpit; share it with testers                                      |

   Generate the random ones with `openssl rand -hex 24`. Values must not contain `'`.

5. **The repository variable `DEMO_DOMAIN`** (Settings → Secrets and variables → Actions → Variables), e.g. `testtix.example.com`. Optional: `DEMO_API_REPLICAS` (default 2). The demo workflows do nothing until `DEMO_DOMAIN` is set.

Then run the **Demo deploy** workflow by hand (Actions → Demo deploy → Run workflow, on `main`). The first run creates `~/testtix` on the server, gets the certificates and seeds the database.

## Deploying

The **Demo deploy** workflow (`.github/workflows/demo-deploy.yml`) runs after every successful CI run on `main`, once CI has pushed that commit's images (`sha-<7>`). Run it by hand to deploy another branch or tag whose images are on GHCR, or a specific image tag (input `image-tag`, e.g. `main` or `1.0.0`). It:

1. writes the server's `~/testtix/.env` from the `demo` environment (registry, image tag, domain, secrets; mode 600),
2. copies `docker/compose.yml` and `docker/demo/` from the deployed commit,
3. runs `docker/demo/compose.sh pull` and `up -d --wait --no-build --remove-orphans`: changed containers are recreated, and `migrate` applies new migrations before the API starts (data is kept); `edge` restarts when its Caddyfile changed,
4. runs the public smoke test (`docker/demo-smoke-test.sh`) from the runner.

Deploys and resets share a concurrency group, so they never overlap. A deploy isn't rolling: compose replaces the API replicas together, so requests during the switch may fail for a few seconds.

**Rolling back:** run the workflow by hand with the last good tag (`sha-<7>` of an earlier commit). If the bad version applied a migration, the database keeps it; Prisma has no down migrations, so a rollback across a schema change means a fix forward or a reset.

## Nightly reset

The **Demo nightly reset** workflow (`.github/workflows/demo-reset.yml`) runs at 03:17 UTC, or by hand. It runs the smoke test, then `POST /__test/reset` with the test key (truncate and reseed; the clock back to real time; waiting rooms and rate-limit counters cleared) and empties Mailpit. The run's log is the record: it prints the seed day and the rows inserted. GitHub pauses scheduled workflows after 60 days without activity in the repository; re-enable it on the Actions tab.

## Checking the demo by hand

```sh
DEMO_DOMAIN=testtix.example.com MAILPIT_UI_AUTH=user:password pnpm demo:check
```

It needs only `curl` and `jq` (no server access) and adds data: a seed scenario and one paid order. Pass `LOAD_TEST_KEY` to skip the rate limits, and `--reset` (with `TEST_API_KEY`) to reset afterwards, like the nightly run.

To try the demo setup locally (Caddy's own CA instead of Let's Encrypt, with `DEMO_DOMAIN=localhost`; `*.localhost` resolves to your machine):

```sh
cat > .env.demo <<'EOF'
DEMO_DOMAIN=localhost
TEST_API_KEY=local-demo-test-api-key
LOAD_TEST_KEY=local-demo-load-test-key
PAYMENTS_API_KEY=local-demo-payments-key
PAYMENTS_WEBHOOK_SECRET=local-demo-webhook-secret
POSTGRES_PASSWORD=localdemo
MAILPIT_UI_AUTH=tester:tester
EOF
docker compose -p testtix-demo --project-directory . --env-file .env.demo \
  -f docker/compose.yml -f docker/demo/compose.yml --profile full up -d --wait --build
DEMO_DOMAIN=localhost MAILPIT_UI_AUTH=tester:tester DEMO_INSECURE=true pnpm demo:check
```

`-p testtix-demo` keeps its containers and volumes apart from your local stack; ports 80 and 443 must be free, and the other host ports too unless you override them in `.env.demo` (git-ignored) (`POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `FAKE_PAYMENTS_PORT`, `WEB_PORT`, `PORT`). Remove it with the same command and `down --volumes`.

## On the server

```sh
cd ~/testtix
docker/demo/compose.sh ps
docker/demo/compose.sh logs -f api worker
docker/demo/compose.sh exec postgres psql -U testtix
```

`.env` is overwritten by every deploy: change settings in the `demo` environment, not on the server. `POSTGRES_PASSWORD` only takes effect when the database volume is first created; to change it later, run `ALTER USER testtix PASSWORD '…'` first, then update the secret and deploy. Certificates live in the `testtix_caddy-data` volume: keep it, since Let's Encrypt limits how often the same names can be issued.
