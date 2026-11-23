#!/usr/bin/env bash
# Checks the `observability` compose profile from the host: Prometheus scrapes every API replica
# and the worker, Grafana has the Prometheus data source and the "Ticket drop" dashboard, every
# dashboard query is valid PromQL, and a short drop (`scripts/drop-load.mjs`) makes the panels move.
# Run from the repo root after `pnpm full:up && pnpm observability:up`: `pnpm observability:check`.
# It adds a drop scenario and customers (it never resets the data). Needs curl and jq.
set -euo pipefail
trap 'echo FAIL' ERR

# Read the same overrides as compose: the shell environment wins over `.env`.
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* || -n "${!key:-}" ]] && continue
    export "$key=$value"
  done < .env
fi

PROMETHEUS_URL="http://127.0.0.1:${PROMETHEUS_PORT:-9090}"
GRAFANA_URL="http://127.0.0.1:${GRAFANA_PORT:-3030}"
API_REPLICAS="${API_REPLICAS:-2}"
DASHBOARD_UID=testtix-ticket-drop
DASHBOARD=docker/observability/grafana/dashboards/ticket-drop.json

step() {
  printf '%-40s' "$1"
}

# The value of an instant query's first result, or empty.
query() {
  curl -fsS -G "${PROMETHEUS_URL}/api/v1/query" --data-urlencode "query=$1" |
    jq -r '.data.result[0].value[1] // empty'
}

# Polls until a query's value is at least $2, for up to 60 seconds.
wait_for_at_least() {
  local value=""
  for _ in $(seq 1 120); do
    value="$(query "$1")"
    if [[ -n "$value" ]] && jq -en --argjson v "$value" --argjson min "$2" '$v >= $min' > /dev/null; then
      printf '%s' "$value"
      return 0
    fi
    sleep 0.5
  done
  printf 'FAIL (%s = %s, expected at least %s)\n' "$1" "${value:-no data}" "$2"
  return 1
}

step "Prometheus ready"
curl -fsS -o /dev/null "${PROMETHEUS_URL}/-/ready"
echo "ok (${PROMETHEUS_URL})"

step "Grafana healthy"
curl -fsS "${GRAFANA_URL}/api/health" | jq -e '.database == "ok"' > /dev/null
echo "ok (${GRAFANA_URL})"

step "API replicas scraped"
echo "ok ($(wait_for_at_least 'sum(up{job="api"})' "$API_REPLICAS"))"

step "Worker scraped"
wait_for_at_least 'sum(up{job="worker"})' 1 > /dev/null
echo ok

step "Grafana data source works"
curl -fsS "${GRAFANA_URL}/api/datasources/uid/prometheus/health" | jq -e '.status == "OK"' > /dev/null
echo ok

step "Dashboard provisioned"
curl -fsS "${GRAFANA_URL}/api/dashboards/uid/${DASHBOARD_UID}" |
  jq -e '.dashboard.title == "Ticket drop"' > /dev/null
echo ok

step "Every dashboard query is valid"
queries=0
while IFS= read -r expr; do
  # Grafana's interval variable, as Prometheus can't expand it.
  expr="${expr//\$__rate_interval/1m}"
  status="$(curl -sS -G "${PROMETHEUS_URL}/api/v1/query" --data-urlencode "query=${expr}" | jq -r .status)"
  if [[ "$status" != "success" ]]; then
    echo "FAIL (${expr})"
    exit 1
  fi
  queries=$((queries + 1))
done < <(jq -r '.panels[].targets[]?.expr' "$DASHBOARD")
echo "ok (${queries})"

# Only series of targets that are up now: Prometheus keeps the last values of a replaced container
# (a restart gives replicas new addresses) for minutes, and those would skew before/after sums.
LIVE='and on (job, instance) (up == 1)'
CREATED="sum(testtix_hold_requests_total{outcome=\"created\"} ${LIVE})"
CONFIRMED="max(testtix_orders{status=\"CONFIRMED\"} ${LIVE})"
ADMITTED="sum(max by (event_id) (testtix_waiting_room_admitted_total ${LIVE}))"
before_created="$(query "$CREATED")"
before_confirmed="$(query "$CONFIRMED")"
before_admitted="$(query "$ADMITTED")"

step "A short drop"
node scripts/drop-load.mjs --customers 10 > /dev/null
echo ok

step "Panels moved: holds"
wait_for_at_least "$CREATED" "$((${before_created:-0} + 1))" > /dev/null
echo ok

step "Panels moved: admissions"
wait_for_at_least "$ADMITTED" "$((${before_admitted:-0} + 10))" > /dev/null
echo ok

step "Panels moved: confirmed orders"
wait_for_at_least "$CONFIRMED" "$((${before_confirmed:-0} + 1))" > /dev/null
echo ok

step "Panels moved: request latency"
wait_for_at_least 'sum(testtix_http_request_duration_seconds_count{job="api",route="/events/:eventId/holds"})' 1 > /dev/null
echo ok

step "Panels moved: job lag"
wait_for_at_least 'sum(testtix_job_wait_seconds_count{queue="order-processing"})' 1 > /dev/null
echo ok

echo "Prometheus and Grafana see the shop: open ${GRAFANA_URL}"
