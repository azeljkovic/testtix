#!/usr/bin/env bash
# Checks the `full` compose profile (the whole shop in containers) from the host: every service is
# healthy, the web app and the API answer through Caddy, and a test purchase goes all the way to an
# e-ticket email. Run from the repo root after `pnpm full:up`: `pnpm full:check`.
# It resets the data (POST /__test/reset), so the server needs test mode (the profile's default).
# Needs curl and jq.
set -euo pipefail
trap 'echo FAIL' ERR

# Read the same overrides as compose: the shell environment wins over `.env`.
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* || -n "${!key:-}" ]] && continue
    export "$key=$value"
  done < .env
fi

API_URL="http://127.0.0.1:${PORT:-3000}"
WEB_URL="http://127.0.0.1:${WEB_PORT:-5173}"
MAILPIT_URL="http://127.0.0.1:${MAILPIT_UI_PORT:-8025}"
API_REPLICAS="${API_REPLICAS:-2}"
# A harmless header when no test API key is configured (bash 3.2 can't expand empty arrays with -u).
test_key=(-H "X-Test-Key: ${TEST_API_KEY:-}")

compose() {
  docker compose --project-directory . -f docker/compose.yml --profile full "$@"
}

step() {
  printf '%-40s' "$1"
}

# Polls a command until it prints a non-empty line, for up to 30 seconds.
wait_for() {
  local result=""
  for _ in $(seq 1 60); do
    result="$("$@")"
    [[ -n "$result" ]] && break
    sleep 0.5
  done
  printf '%s' "$result"
}

step "All services healthy"
unhealthy="$(compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" { print $1 }')"
if [[ -n "$unhealthy" ]]; then
  echo "FAIL (not healthy: ${unhealthy//$'\n'/, })"
  exit 1
fi
echo ok

step "Migrations applied"
migrate_exit="$(compose ps --all --format '{{.Service}} {{.ExitCode}}' | awk '$1 == "migrate" { print $2 }')"
if [[ "$migrate_exit" != "0" ]]; then
  echo "FAIL (migrate exit code: ${migrate_exit:-not run})"
  exit 1
fi
echo ok

step "API replicas running"
replicas="$(compose ps --format '{{.Service}} {{.Health}}' | awk '$1 == "api" && $2 == "healthy"' | wc -l | tr -d ' ')"
if [[ "$replicas" != "$API_REPLICAS" ]]; then
  echo "FAIL ($replicas healthy, expected $API_REPLICAS)"
  exit 1
fi
echo "ok ($replicas)"

step "Worker ready"
compose exec -T worker node -e \
  "fetch('http://127.0.0.1:3001/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
echo ok

step "API ready"
curl -fsS "${API_URL}/health/ready" | jq -e '.status == "ok"' > /dev/null
echo "ok (${API_URL})"

step "Web app served"
curl -fsS "${WEB_URL}/" | grep -q '<div id="root">'
# Client-side routes get the app too.
curl -fsS "${WEB_URL}/events/some-event" | grep -q '<div id="root">'
echo "ok (${WEB_URL})"

step "Security headers"
web_headers="$(curl -fsS -o /dev/null -D - "${WEB_URL}/")"
grep -qi "^content-security-policy: default-src 'self'" <<< "$web_headers"
grep -qi '^x-content-type-options: nosniff' <<< "$web_headers"
if grep -qi '^server:' <<< "$web_headers"; then
  echo "FAIL (the web app names its server)"
  exit 1
fi
for url in "${API_URL}/health" "${WEB_URL}/api/health"; do
  curl -fsS -o /dev/null -D - "$url" | grep -qi "^content-security-policy: default-src 'none'"
done
echo ok

step "API under the web app's /api"
curl -fsS "${WEB_URL}/api/health" | jq -e '.status == "ok"' > /dev/null
echo ok

step "Reset the data"
curl -fsS -o /dev/null -X POST "${API_URL}/__test/reset" "${test_key[@]}"
echo ok

step "Check out a hold"
seed="$(curl -fsS -X POST "${API_URL}/__test/seed/hold-about-to-expire" \
  -H 'Content-Type: application/json' -d '{"expiresInSec":600}')"
auth=(-H "Cookie: $(jq -r .holder.cookie <<< "$seed")" -H "X-CSRF-Token: $(jq -r .holder.csrfToken <<< "$seed")")
email="$(jq -r .holder.user.email <<< "$seed")"
order="$(curl -fsS -X POST "${API_URL}/orders" "${auth[@]}" -H 'Content-Type: application/json' \
  -d "{\"holdId\":\"$(jq -r .hold.id <<< "$seed")\"}")"
order_id="$(jq -r .id <<< "$order")"
payment_url="$(jq -r .paymentUrl <<< "$order")"
echo "ok (order ${order_id})"

step "Pay on the payment page"
status="$(curl -sS -o /dev/null -w '%{http_code}' "${payment_url/localhost/127.0.0.1}" \
  --data-urlencode cardNumber='4242 4242 4242 4242' --data-urlencode expiry='12/40' \
  --data-urlencode cvc=123 --data-urlencode name='Smoke Test')"
if [[ "$status" != "303" ]]; then
  echo "FAIL (payment page answered $status)"
  exit 1
fi
echo ok

step "Order confirmed (webhook + worker)"
confirmed() {
  curl -fsS "${API_URL}/orders/${order_id}" "${auth[@]}" |
    jq -r 'select(.status == "CONFIRMED" and all(.items[]; .ticket != null)) | .status'
}
if [[ -z "$(wait_for confirmed)" ]]; then
  echo "FAIL (status: $(curl -fsS "${API_URL}/orders/${order_id}" "${auth[@]}" | jq -r .status))"
  exit 1
fi
echo ok

step "E-ticket email in Mailpit"
tickets_email() {
  curl -fsS -G "${MAILPIT_URL}/api/v1/search" \
    --data-urlencode "query=to:\"${email}\" subject:\"Your tickets for\"" |
    jq -r '.messages[0].ID // empty'
}
if [[ -z "$(wait_for tickets_email)" ]]; then
  echo "FAIL (no email to ${email})"
  exit 1
fi
echo ok

echo "The full stack is up and sells tickets."
