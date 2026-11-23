#!/usr/bin/env node
/**
 * A short ticket drop against a running API in test mode, to make the observability profile's
 * "Ticket drop" dashboard move (C6.2). Not a load test: the k6 tests in the tests repo are.
 *
 *   pnpm observability:load                  # 30 customers
 *   pnpm observability:load --customers 60   # more
 *
 * It adds a `drop-open-now` scenario (5 customers let in per second) and logged-in customers
 * (`POST /__test/sessions`), then each customer queues, waits to be let in, picks two of the first
 * free seats (so customers let in together collide: 409s; standing places once the seats are
 * gone), checks out and pays with a test card:
 * most succeed, some are declined, some never pay (their orders stay pending until they expire).
 * It only adds data, never resets it.
 *
 * The API is http://localhost:3000 (`API_URL` to change it); the payment pages are wherever the
 * API's orders point. `LOAD_TEST_KEY` is sent as `X-Load-Test-Key` when set, so a server with the
 * same key doesn't rate-limit the run; without it the run stays under the default limits and waits
 * out any 429 it gets.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const LOAD_TEST_KEY = process.env.LOAD_TEST_KEY ?? '';
const { values: args } = parseArgs({
  // pnpm passes a `--` separator through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { customers: { type: 'string', default: '30' } },
});
const CUSTOMERS = Number(args.customers);
if (!Number.isInteger(CUSTOMERS) || CUSTOMERS < 1 || CUSTOMERS > 250) {
  console.error('--customers must be a whole number from 1 to 250');
  process.exit(2);
}

/** Seats per hold, and how many of the first free seats a customer picks from. */
const SEATS_PER_HOLD = 2;
const PICK_FROM = 6;
const HOLD_ATTEMPTS = 4;
/** What each customer does at the payment page, in turn. */
const PAYMENTS = [
  { card: '4242 4242 4242 4242', outcome: 'paid' },
  { card: '4242 4242 4242 4242', outcome: 'paid' },
  { card: '4242 4242 4242 4242', outcome: 'paid' },
  { card: '4000 0000 0000 0002', outcome: 'declined' },
  { card: null, outcome: 'unpaid' },
];

const tally = new Map();
function count(what) {
  tally.set(what, (tally.get(what) ?? 0) + 1);
}

class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} answered ${String(status)}: ${body}`);
    this.status = status;
  }
}

/** Calls the API; waits out 429s. Returns the parsed JSON body (null for none). */
async function api(method, path, { session, body, headers = {} } = {}) {
  for (;;) {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session === undefined
          ? {}
          : { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken }),
        ...(LOAD_TEST_KEY === '' ? {} : { 'X-Load-Test-Key': LOAD_TEST_KEY }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      count('rate limited (429, waited)');
      await sleep(Number(res.headers.get('retry-after') ?? '1') * 1000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(method, path, res.status, text);
    return text === '' ? null : JSON.parse(text);
  }
}

function freeSeats(seatMap) {
  return seatMap.sections.flatMap((section) =>
    section.type === 'SEATED'
      ? section.rows.flatMap((row) => row.seats.filter((seat) => seat.status === 'AVAILABLE'))
      : [],
  );
}

/**
 * Two of the first free seats, or two standing places (when `standing`, or no seats are left);
 * null when sold out.
 */
function pickTickets(seatMap, standing) {
  const candidates = freeSeats(seatMap).slice(0, PICK_FROM);
  if (candidates.length >= SEATS_PER_HOLD && !standing) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return { seats: candidates.slice(0, SEATS_PER_HOLD).map((seat) => seat.id), ga: [] };
  }
  const area = seatMap.sections.find(
    (section) => section.type === 'GA' && section.available >= SEATS_PER_HOLD,
  );
  if (area !== undefined)
    return { seats: [], ga: [{ sectionId: area.id, quantity: SEATS_PER_HOLD }] };
  return standing ? pickTickets(seatMap, false) : null;
}

async function waitToBeLetIn(session, eventId) {
  let entry = await api('POST', `/events/${eventId}/queue`, { session });
  while (entry.status !== 'ADMITTED') {
    if (entry.retryAfterMs === null) throw new Error(`Queue entry ended as ${entry.status}`);
    await sleep(entry.retryAfterMs);
    entry = await api('GET', `/queue/${entry.token}`, { session });
  }
  return entry.admission.token;
}

async function holdTickets(session, eventId, admissionToken) {
  const headers = { 'X-Admission-Token': admissionToken };
  for (let attempt = 1; attempt <= HOLD_ATTEMPTS; attempt++) {
    const seatMap = await api('GET', `/events/${eventId}/seats`, { headers });
    // Customers who lost the race for seats twice settle for standing places.
    const tickets = pickTickets(seatMap, attempt > 2);
    if (tickets === null) return 'sold out';
    try {
      return await api('POST', `/events/${eventId}/holds`, { session, headers, body: tickets });
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 409) throw err;
      count('hold conflicts (409)');
    }
  }
  return `${String(HOLD_ATTEMPTS)} conflicts in a row`;
}

async function pay(paymentUrl, card) {
  // The fake provider listens on 127.0.0.1; `localhost` may resolve to ::1 first.
  const res = await fetch(paymentUrl.replace('://localhost:', '://127.0.0.1:'), {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ cardNumber: card, expiry: '12/40', cvc: '123', name: 'Drop Load' }),
  });
  if (res.status !== 303) throw new Error(`The payment page answered ${String(res.status)}`);
}

async function customer(session, eventId, index) {
  const admissionToken = await waitToBeLetIn(session, eventId);
  count('let in');
  const hold = await holdTickets(session, eventId, admissionToken);
  if (typeof hold === 'string') {
    count(`gave up (${hold})`);
    return;
  }
  count('holds');
  const order = await api('POST', '/orders', { session, body: { holdId: hold.id } });
  const { card, outcome } = PAYMENTS[index % PAYMENTS.length];
  if (card !== null) await pay(order.paymentUrl, card);
  count(`orders ${outcome}`);
}

async function main() {
  await api('GET', '/health/ready');
  const { event } = await api('POST', '/__test/seed/drop-open-now', {
    body: { admissionRatePerSec: 5 },
  });
  console.log(`Drop "${event.title}" (${event.id}), ${String(CUSTOMERS)} customers`);
  const sessions = [];
  for (let i = 0; i < CUSTOMERS; i++) {
    sessions.push(await api('POST', '/__test/sessions', { body: { role: 'CUSTOMER' } }));
  }

  const started = performance.now();
  const results = await Promise.allSettled(
    sessions.map((session, i) => customer(session, event.id, i)),
  );
  const failures = results.filter((r) => r.status === 'rejected');
  for (const failure of failures.slice(0, 5)) console.error(`  ${String(failure.reason)}`);

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${seconds} s:`);
  for (const [what, n] of [...tally].sort()) console.log(`  ${what}: ${String(n)}`);
  if (failures.length > 0) {
    console.error(`  failed customers: ${String(failures.length)}`);
    process.exitCode = 1;
  }
}

await main();
