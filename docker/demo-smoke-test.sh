#!/usr/bin/env bash
# Checks the hosted demo from the outside, over its public addresses: HTTPS and the redirect to it,
# Secure cookies, security headers, what stays private (metrics, the test API without its key, Mailpit without a
# login, the provider's API), and a test purchase that goes all the way to an e-ticket email.
# It only adds data (a seed scenario), unless --reset is passed.
#
#   DEMO_DOMAIN=demo.example.com MAILPIT_UI_AUTH=user:password bash docker/demo-smoke-test.sh
#   ... TEST_API_KEY=... bash docker/demo-smoke-test.sh --reset   # the nightly reset
#
# --reset   afterwards, reset the data (POST /__test/reset, needs TEST_API_KEY) and empty Mailpit,
#           then check that the seed data is back.
# LOAD_TEST_KEY (optional) lifts the rate limits. DEMO_INSECURE=true accepts certificates no CA
# vouches for (Caddy's local CA, for a local run with DEMO_DOMAIN=localhost).
# Needs curl and jq.
set -euo pipefail
trap 'echo FAIL' ERR

reset=false
case "${1:-}" in
  --reset) reset=true ;;
  '') ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
esac

: "${DEMO_DOMAIN:?set DEMO_DOMAIN (host name of the shop)}"
: "${MAILPIT_UI_AUTH:?set MAILPIT_UI_AUTH (user:password for Mailpit)}"
if $reset; then
  : "${TEST_API_KEY:?set TEST_API_KEY (--reset needs it)}"
fi

WEB_URL="https://${DEMO_DOMAIN}"
API_URL="https://api.${DEMO_DOMAIN}"
PAY_URL="https://pay.${DEMO_DOMAIN}"
MAIL_URL="https://mail.${DEMO_DOMAIN}"

opts=(-sS --connect-timeout 10 --max-time 30 -H "X-Load-Test-Key: ${LOAD_TEST_KEY:-}")
[[ "${DEMO_INSECURE:-false}" == "true" ]] && opts+=(--insecure)
mail_auth=(-u "$MAILPIT_UI_AUTH")

# curl with the options above: `get <url> [curl args]` fails on 4xx/5xx; `status` prints the code.
get() {
  curl "${opts[@]}" -f "$@"
}
status() {
  curl "${opts[@]}" -o /dev/null -w '%{http_code}' "$@"
}

step() {
  printf '%-44s' "$1"
}

expect_status() {
  local expected="$1"
  shift
  local actual
  actual="$(status "$@")"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL ($* answered $actual, expected $expected)"
    exit 1
  fi
}

# Polls a command until it prints a non-empty line, for up to a minute.
wait_for() {
  local result=""
  for _ in $(seq 1 60); do
    result="$("$@")"
    [[ -n "$result" ]] && break
    sleep 1
  done
  printf '%s' "$result"
}

# A fresh server may still be getting its certificates, and a deploy restarting containers.
step "API answers over HTTPS"
ready() {
  curl "${opts[@]}" -f "${API_URL}/health/ready" 2> /dev/null | jq -r 'select(.status == "ok") | .status' || true
}
if [[ -z "$(wait_for ready)" ]]; then
  echo "FAIL (${API_URL}/health/ready: $(curl "${opts[@]}" "${API_URL}/health/ready" 2>&1 || true))"
  exit 1
fi
echo "ok (${API_URL})"

step "HTTP redirects to HTTPS"
for host in "$DEMO_DOMAIN" "api.$DEMO_DOMAIN" "pay.$DEMO_DOMAIN" "mail.$DEMO_DOMAIN"; do
  redirect="$(curl "${opts[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "http://${host}/x")"
  if [[ "$redirect" != "308 https://${host}/x" ]]; then
    echo "FAIL (http://${host}/x: ${redirect})"
    exit 1
  fi
done
echo ok

step "Web app over HTTPS"
get "${WEB_URL}/" | grep -q '<div id="root">'
get "${WEB_URL}/events/some-event" | grep -q '<div id="root">'
echo "ok (${WEB_URL})"

step "API under the web app's /api"
get "${WEB_URL}/api/health/ready" | jq -e '.status == "ok"' > /dev/null
echo ok

step "Cookies are Secure"
cookie="$(curl "${opts[@]}" -f -o /dev/null -D - "${API_URL}/auth/csrf" | grep -i '^set-cookie:' || true)"
if [[ -z "$cookie" ]] || ! grep -qi '; *secure' <<< "$cookie"; then
  echo "FAIL (GET /auth/csrf set: ${cookie:-no cookie})"
  exit 1
fi
echo ok

# `has_header <header line regex> <curl args>`: the response has a matching header (any case).
has_header() {
  local pattern="$1" headers
  shift
  headers="$(curl "${opts[@]}" -f -o /dev/null -D - "$@")"
  if ! grep -qiE "^${pattern}" <<< "$headers"; then
    echo "FAIL ($* has no header matching '${pattern}')"
    exit 1
  fi
}

step "Security headers"
hsts='strict-transport-security: max-age=[0-9]+'
for url in "${WEB_URL}/" "${API_URL}/health" "${PAY_URL}/assets/pay.css"; do
  has_header "$hsts" "$url"
done
has_header "$hsts" "${mail_auth[@]}" "${MAIL_URL}/api/v1/messages?limit=1"
has_header "content-security-policy: default-src 'self'" "${WEB_URL}/"
has_header 'x-content-type-options: nosniff' "${WEB_URL}/"
has_header "content-security-policy: default-src 'none'" "${API_URL}/health"
echo ok

step "Metrics not public"
for url in "${API_URL}/metrics" "${API_URL}//metrics" "${API_URL}/metrics/" "${WEB_URL}/api/metrics"; do
  expect_status 404 "$url"
done
echo ok

step "Test API reset needs the key"
expect_status 401 -X POST "${API_URL}/__test/reset"
echo ok

step "Mailpit needs a login"
expect_status 401 "${MAIL_URL}/api/v1/messages"
expect_status 200 "${mail_auth[@]}" "${MAIL_URL}/api/v1/messages"
echo ok

step "Provider serves only its payment page"
expect_status 200 "${PAY_URL}/assets/pay.css"
expect_status 404 "${PAY_URL}/sessions"
expect_status 404 "${PAY_URL}/health"
echo ok

step "Check out a hold"
seed="$(get -X POST "${API_URL}/__test/seed/hold-about-to-expire" \
  -H 'Content-Type: application/json' -d '{"expiresInSec":600}')"
auth=(-H "Cookie: $(jq -r .holder.cookie <<< "$seed")" -H "X-CSRF-Token: $(jq -r .holder.csrfToken <<< "$seed")")
email="$(jq -r .holder.user.email <<< "$seed")"
order="$(get -X POST "${API_URL}/orders" "${auth[@]}" -H 'Content-Type: application/json' \
  -d "{\"holdId\":\"$(jq -r .hold.id <<< "$seed")\"}")"
order_id="$(jq -r .id <<< "$order")"
payment_url="$(jq -r .paymentUrl <<< "$order")"
if [[ "$payment_url" != "${PAY_URL}/pay/"* ]]; then
  echo "FAIL (payment page at ${payment_url}, expected ${PAY_URL}/pay/…)"
  exit 1
fi
echo "ok (order ${order_id})"

step "Pay on the payment page"
expect_status 303 "$payment_url" \
  --data-urlencode cardNumber='4242 4242 4242 4242' --data-urlencode expiry='12/40' \
  --data-urlencode cvc=123 --data-urlencode name='Demo Smoke Test'
echo ok

step "Order confirmed (webhook + worker)"
confirmed() {
  get "${API_URL}/orders/${order_id}" "${auth[@]}" |
    jq -r 'select(.status == "CONFIRMED" and all(.items[]; .ticket != null)) | .status'
}
if [[ -z "$(wait_for confirmed)" ]]; then
  echo "FAIL (status: $(get "${API_URL}/orders/${order_id}" "${auth[@]}" | jq -r .status))"
  exit 1
fi
echo ok

step "E-ticket email in Mailpit"
tickets_email() {
  get "${mail_auth[@]}" -G "${MAIL_URL}/api/v1/search" \
    --data-urlencode "query=to:\"${email}\" subject:\"Your tickets for\"" |
    jq -r '.messages[0].ID // empty'
}
if [[ -z "$(wait_for tickets_email)" ]]; then
  echo "FAIL (no email to ${email})"
  exit 1
fi
echo ok

if $reset; then
  step "Reset the data"
  result="$(get -X POST "${API_URL}/__test/reset" -H "X-Test-Key: ${TEST_API_KEY}")"
  echo "ok ($(jq -c '{seedDay, rows}' <<< "$result"))"

  step "Empty Mailpit"
  get "${mail_auth[@]}" -o /dev/null -X DELETE "${MAIL_URL}/api/v1/messages"
  echo ok

  step "Seed data back"
  get "${API_URL}/events?pageSize=1" | jq -e '.total > 0' > /dev/null
  get "${mail_auth[@]}" "${MAIL_URL}/api/v1/messages?limit=1" | jq -e '.total == 0' > /dev/null
  echo ok
fi

echo "The demo at ${WEB_URL} is up and sells tickets."
