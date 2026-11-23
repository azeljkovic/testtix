import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { browserLocation } from '../app/browser-location.js';
import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { concert, meetup } from '../testing/catalogue-fixtures.js';
import { advanceClock, fakeClockAt, settleWithFakeClock } from '../testing/fake-clock.js';
import { FIXTURE_HOLD_ID, holdOf, mockCurrentHold } from '../testing/holds.js';
import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import {
  FIXTURE_ORDER_ID,
  FIXTURE_PAYMENT_URL,
  mockCreateOrder,
  mockOrder,
  orderOf,
} from '../testing/orders.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { concertSeatMap, fixtureSeatId, meetupSeatMap } from '../testing/seat-fixtures.js';

const CHECKOUT = '/events/midnight-echoes-live/checkout';
const B1 = fixtureSeatId(1, 'B', 1);
const B2 = fixtureSeatId(1, 'B', 2);

/** The fake clock's start in the countdown tests. */
const NOW = Date.parse('2026-11-22T18:00:00.000Z');

/** Seats B1 and B2 of the concert ($178.00), held `agoMs` before `now`. */
function concertHold({ now = Date.now(), agoMs = 60_000 } = {}) {
  return holdOf(concertSeatMap, { seats: [B1, B2] }, { createdAt: now - agoMs });
}

function payButton() {
  return screen.getByRole('button', { name: 'Pay $178.00' });
}

let assign: MockInstance<(url: string) => void>;

beforeEach(() => {
  assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkout', () => {
  it('sends visitors who aren’t logged in to log in, then back to the checkout', async () => {
    const { router } = renderApp(CHECKOUT);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?redirectTo=${encodeURIComponent(CHECKOUT)}`);
  });

  it('shows the held tickets, the total and the time left to pay', async () => {
    logInAs(customer);
    // Held 4 minutes ago: 6 of the 10 minutes are left.
    const eventIds = mockCurrentHold(concertHold({ agoMs: 240_000 }));
    renderApp(CHECKOUT);

    expect(await screen.findByRole('heading', { level: 1, name: 'Check out' })).toBeInTheDocument();
    expect(eventIds).toEqual([concert.id]);
    expect(document.title).toBe('Check out: Midnight Echoes Live · TestTix');
    expect(screen.getByText(/Midnight Echoes Live ·/)).toHaveTextContent(
      'Midnight Echoes Live · Sat, Dec 12, 2026, 11:30 PM EST · Riverside Hall',
    );
    const tickets = within(screen.getByRole('region', { name: 'Your tickets' }));
    expect(tickets.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Stalls, row B, seat 1$89.00',
      'Stalls, row B, seat 2$89.00',
    ]);
    expect(tickets.getAllByRole('definition').map((dd) => dd.textContent)).toEqual([
      '2',
      '$178.00',
    ]);
    expect(screen.getByRole('timer', { name: 'Time left to pay' })).toHaveTextContent(
      /^(6:00|5:5\d)$/,
    );
    expect(payButton()).toBeEnabled();
    expect(screen.getByRole('link', { name: '‹ Back to the seat map' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live/seats',
    );

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('creates the order and sends the customer to the payment page', async () => {
    logInAs(customer);
    const hold = concertHold();
    mockCurrentHold(hold);
    const requests = mockCreateOrder(() => orderOf(hold, concert));
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(FIXTURE_PAYMENT_URL);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ holdId: FIXTURE_HOLD_ID });
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    // Busy until the browser has left: a second press does nothing.
    const busy = screen.getByRole('button', { name: 'Opening the payment page…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(requests).toHaveLength(1);
  });

  it('takes a free order straight to its order page', async () => {
    logInAs(customer);
    const hold = { ...concertHold(), totalCents: 0 };
    hold.items = hold.items.map((item) => ({ ...item, priceCents: 0 }));
    mockCurrentHold(hold);
    const processing = orderOf(hold, concert, { status: 'PROCESSING', paymentUrl: null });
    mockCreateOrder(() => processing);
    mockOrder(FIXTURE_ORDER_ID, processing);
    const { user, router } = renderApp(CHECKOUT);

    expect(await screen.findByRole('heading', { name: 'Confirm your order' })).toBeInTheDocument();
    expect(screen.getByText(/These tickets are free/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm order' }));

    expect(
      await screen.findByRole('heading', { name: 'Processing your payment' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/orders/${FIXTURE_ORDER_ID}`);
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when nothing is held for the event', async () => {
    logInAs(customer);
    renderApp(CHECKOUT);

    expect(
      await screen.findByText(/You have no tickets on hold for this event/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose tickets' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live/seats',
    );
    expect(screen.getByRole('link', { name: 'Your orders' })).toHaveAttribute('href', '/orders');
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('shows the event-not-found page for an unknown event', async () => {
    logInAs(customer);
    renderApp('/events/no-such-event/checkout');

    expect(await screen.findByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
  });

  it('asks a customer with an unverified email to verify it first', async () => {
    logInAs({ ...customer, emailVerified: false });
    mockCurrentHold(concertHold());
    renderApp(CHECKOUT);

    expect(
      await screen.findByRole('heading', { name: 'Verify your email address' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/We sent a verification link to ada@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send a new verification email' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('picks up an unverified email from the API’s 403', async () => {
    logInAs(customer);
    mockCurrentHold(concertHold());
    mockCreateOrder(() => {
      // The session was out of date: the API knows better.
      logInAs({ ...customer, emailVerified: false });
      return problemResponse({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
    });
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Verify your email address before you check out.',
    );
    expect(
      await screen.findByRole('heading', { name: 'Verify your email address' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('keeps the hold and lets the customer retry when the payment provider fails', async () => {
    logInAs(customer);
    const hold = concertHold();
    mockCurrentHold(hold);
    let attempts = 0;
    const requests = mockCreateOrder(() =>
      ++attempts === 1
        ? problemResponse({ status: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE' })
        : orderOf(hold, concert),
    );
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t reach the payment provider. Your tickets are still held: try again in a moment.',
    );
    expect(assign).not.toHaveBeenCalled();

    await user.click(payButton());
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(FIXTURE_PAYMENT_URL);
    });
    expect(requests).toHaveLength(2);
  });

  it('says the tickets are off sale when the event stopped selling (409)', async () => {
    logInAs(customer);
    mockCurrentHold(concertHold());
    mockCreateOrder(() => problemResponse({ status: 409, code: 'EVENT_NOT_ON_SALE' }));
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tickets for this event are no longer on sale, so you can’t check out.',
    );
  });

  it('shows the hold as gone when the API no longer has it (404)', async () => {
    logInAs(customer);
    const hold = concertHold();
    let current: typeof hold | null = hold;
    mockCreateOrder(() => {
      // Released in another tab.
      current = null;
      return problemResponse({ status: 404 });
    });
    server.use(
      http.get('/api/holds/current', () =>
        current === null ? problemResponse({ status: 404 }) : HttpResponse.json(current),
      ),
    );
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));

    expect(
      await screen.findByText(/You have no tickets on hold for this event/),
    ).toBeInTheDocument();
  });

  it('says the hold expired when the API says so (409 hold-expired)', async () => {
    logInAs(customer);
    mockCurrentHold(concertHold());
    mockCreateOrder(() => problemResponse({ status: 409, code: 'HOLD_EXPIRED' }));
    const { user } = renderApp(CHECKOUT);

    await user.click(await screen.findByRole('button', { name: 'Pay $178.00' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your hold expired');
    expect(within(alert).getByRole('link', { name: 'Choose tickets again' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live/seats',
    );
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('ends the checkout when the hold’s time runs out', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    // 61 seconds left.
    mockCurrentHold(concertHold({ now: NOW, agoMs: 539_000 }));
    renderApp(CHECKOUT);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('timer')).toHaveTextContent('1:01');
    });

    advanceClock(1000);
    expect(screen.getByRole('timer')).toHaveTextContent('1:00');
    expect(screen.getByRole('status')).toHaveTextContent('Less than a minute left on your hold.');

    advanceClock(60_000);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your hold expired');
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('checkout from the seat map', () => {
  it('goes from the hold panel to the checkout', async () => {
    logInAs(customer);
    mockCurrentHold(concertHold());
    const { user, router } = renderApp('/events/midnight-echoes-live/seats');

    await user.click(await screen.findByRole('link', { name: 'Check out' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Check out' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(CHECKOUT);
  });

  it('checks out general admission tickets too', async () => {
    logInAs(customer);
    const hold = holdOf(meetupSeatMap, {
      ga: [{ sectionId: '01970000-0000-7000-8000-0000000000b3', quantity: 3 }],
    });
    mockCurrentHold(hold);
    mockCreateOrder(() => orderOf(hold, meetup));
    const { user } = renderApp('/events/flaky-tests-clinic/checkout');

    const tickets = within(await screen.findByRole('list', { name: 'Tickets in this order' }));
    expect(tickets.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Loft, 3 tickets$35.00',
    ]);
    await user.click(screen.getByRole('button', { name: 'Pay $35.00' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(FIXTURE_PAYMENT_URL);
    });
  });
});
