#!/usr/bin/env bash
# Checks that the local infra (docker/compose.yml) is up and usable from the host.
# Run from the repo root after `pnpm infra:up`: `pnpm infra:check`.
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

POSTGRES_USER="${POSTGRES_USER:-testtix}"
POSTGRES_DB="${POSTGRES_DB:-testtix}"
MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-1025}"
MAILPIT_UI_PORT="${MAILPIT_UI_PORT:-8025}"
MAILPIT_URL="http://127.0.0.1:${MAILPIT_UI_PORT}"
FAKE_PAYMENTS_URL="http://127.0.0.1:${FAKE_PAYMENTS_PORT:-4000}"
PAYMENTS_API_KEY="${PAYMENTS_API_KEY:-sk_test_testtix_local_only}"

compose() {
  docker compose --project-directory . -f docker/compose.yml "$@"
}

step() {
  printf '%-34s' "$1"
}

step "All services healthy"
unhealthy="$(compose ps --all --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" { print $1 }')"
if [[ -n "$unhealthy" ]]; then
  echo "FAIL (not healthy: ${unhealthy//$'\n'/, })"
  exit 1
fi
echo ok

step "Postgres accepts queries"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'select 1' | grep -qx 1
echo ok

step "Redis answers PING"
compose exec -T redis redis-cli ping | grep -qx PONG
echo ok

step "Mailpit UI reachable"
curl -fsS -o /dev/null "${MAILPIT_URL}/"
echo "ok (${MAILPIT_URL})"

step "Mailpit receives SMTP mail"
subject="TestTix infra smoke test $(date +%s)-$$"
printf 'From: smoke@testtix.test\r\nTo: inbox@testtix.test\r\nSubject: %s\r\n\r\nHello from the infra smoke test.\r\n' "$subject" |
  curl -fsS "smtp://127.0.0.1:${MAILPIT_SMTP_PORT}" \
    --mail-from smoke@testtix.test --mail-rcpt inbox@testtix.test --upload-file -
ids=""
for _ in $(seq 1 20); do
  ids="$(curl -fsS -G "${MAILPIT_URL}/api/v1/search" --data-urlencode "query=subject:\"${subject}\"" | jq -c '[.messages[].ID]')"
  [[ "$ids" != "[]" ]] && break
  sleep 0.25
done
if [[ "$ids" == "[]" ]]; then
  echo "FAIL (message not found)"
  exit 1
fi
# Leave the mailbox as we found it.
curl -fsS -o /dev/null -X DELETE "${MAILPIT_URL}/api/v1/messages" \
  -H 'Content-Type: application/json' -d "{\"IDs\":${ids}}"
echo ok

step "Fake payments creates a session"
page_url="$(curl -fsS "${FAKE_PAYMENTS_URL}/sessions" \
  -H "Authorization: Bearer ${PAYMENTS_API_KEY}" -H 'Content-Type: application/json' \
  -d '{"amountCents":100,"currency":"USD","description":"Infra smoke test","returnUrl":"http://localhost:5173/","webhookUrl":"http://host.docker.internal:3000/webhooks/payments"}' |
  jq -r .url)"
curl -fsS -o /dev/null "${page_url/localhost/127.0.0.1}"
echo "ok (${FAKE_PAYMENTS_URL})"

echo "Local infra is ready."
