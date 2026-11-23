import { screen, waitFor, within } from '@testing-library/react';
import type { OrderStatus } from '@testtix/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE_URL } from '../api/client.js';
import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { concert, meetup } from '../testing/catalogue-fixtures.js';
import { advanceClock, fakeClockAt, settleWithFakeClock } from '../testing/fake-clock.js';
import { holdOf } from '../testing/holds.js';
import {
  FIXTURE_ORDER_ID,
  FIXTURE_PAYMENT_URL,
  fixtureTicketCode,
  fixtureTicketId,
  mockOrder,
  orderOf,
} from '../testing/orders.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { concertSeatMap, fixtureSeatId, meetupSeatMap } from '../testing/seat-fixtures.js';

const ORDER_PATH = `/orders/${FIXTURE_ORDER_ID}`;
const LOFT = '01970000-0000-7000-8000-0000000000b3';
const B1 = fixtureSeatId(1, 'B', 1);
const B2 = fixtureSeatId(1, 'B', 2);

/** The fake clock's start in the polling tests. */
const NOW = Date.parse('2026-11-22T18:00:00.000Z');

/** The concert order for seats B1 and B2 ($178.00), placed `agoMs` before `now`. */
function concertOrder(
  status: OrderStatus,
  options: Parameters<typeof orderOf>[2] = {},
  { now = Date.now(), agoMs = 60_000 } = {},
) {
  const hold = holdOf(concertSeatMap, { seats: [B1, B2] }, { createdAt: now - agoMs });
  return orderOf(hold, concert, { status, ...options });
}

function heading() {
  return screen.getByRole('heading', { level: 1 });
}

/** The live region that holds the status heading and message. */
function statusRegion() {
  const region = heading().closest('[role="status"]');
  if (!(region instanceof HTMLElement))
    throw new Error('The status heading isn’t in a live region');
  return region;
}

function listed(name: string) {
  return within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('order page', () => {
  it('sends visitors who aren’t logged in to log in, then back to the order', async () => {
    const { router } = renderApp(ORDER_PATH);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?redirectTo=${encodeURIComponent(ORDER_PATH)}`);
  });

  it('says so when the order doesn’t exist or isn’t yours (404)', async () => {
    logInAs(customer);
    renderApp(ORDER_PATH);

    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your orders' })).toHaveAttribute('href', '/orders');
    expect(document.title).toBe('Order not found · TestTix');
  });

  it('treats an address that isn’t an order ID (400) as not found', async () => {
    logInAs(customer);
    mockOrder('not-an-id', problemResponse({ status: 400, code: 'VALIDATION_ERROR' }));
    renderApp('/orders/not-an-id');

    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
  });

  it('offers a retry when the order can’t be loaded', async () => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, problemResponse({ status: 500 }), concertOrder('CONFIRMED'));
    const { user } = renderApp(ORDER_PATH);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side. Please try again.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Your tickets are confirmed' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['PENDING_PAYMENT', 'Waiting for your payment', /haven’t heard from the payment provider/],
    ['PROCESSING', 'Processing your payment', /finishing your order/],
    ['CONFIRMED', 'Your tickets are confirmed', /2 tickets for Midnight Echoes Live/],
    ['FAILED', 'Payment failed', /payment didn’t go through.*tickets were released/],
    ['EXPIRED', 'Order expired', /wasn’t paid while its tickets were held/],
  ] as const)('shows a %s order', async (status, title, message) => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, concertOrder(status));
    renderApp(ORDER_PATH);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(statusRegion()).toHaveTextContent(message);
    expect(document.title).toBe(`${title} · TestTix`);

    const summary = within(screen.getByRole('region', { name: 'Order summary' }));
    expect(summary.getByRole('link', { name: 'Midnight Echoes Live' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live',
    );
    expect(summary.getByText('Sat, Dec 12, 2026, 11:30 PM EST')).toBeInTheDocument();
    expect(summary.getByText(FIXTURE_ORDER_ID)).toBeInTheDocument();
    expect(summary.getByText('Riverside Hall')).toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('shows an unpaid order’s countdown and the way back to the payment page', async () => {
    logInAs(customer);
    // Placed 4 minutes ago: 6 of the 10 minutes are left.
    mockOrder(FIXTURE_ORDER_ID, concertOrder('PENDING_PAYMENT', {}, { agoMs: 240_000 }));
    renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Waiting for your payment' });

    expect(screen.getByRole('timer', { name: 'Time left to pay' })).toHaveTextContent(
      /^(6:00|5:5\d)$/,
    );
    expect(screen.getByRole('link', { name: 'Continue to payment' })).toHaveAttribute(
      'href',
      FIXTURE_PAYMENT_URL,
    );
    expect(screen.getByRole('link', { name: 'Change tickets' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live/seats',
    );
    expect(listed('Tickets in this order')).toEqual([
      'Stalls, row B, seat 1$89.00',
      'Stalls, row B, seat 2$89.00',
    ]);
  });

  it('has no payment link while the provider hasn’t answered', async () => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, concertOrder('PENDING_PAYMENT', { paymentUrl: null }));
    renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Waiting for your payment' });

    expect(screen.queryByRole('link', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('lists a confirmed order’s tickets with their codes and PDF downloads', async () => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, concertOrder('CONFIRMED'));
    renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Your tickets are confirmed' });

    expect(statusRegion()).toHaveTextContent('We’ve emailed them to ada@example.com.');
    expect(listed('Your tickets')).toEqual([
      `Stalls, row B, seat 1$89.00Ticket code ${fixtureTicketCode(1)}Download PDF: Stalls, row B, seat 1`,
      `Stalls, row B, seat 2$89.00Ticket code ${fixtureTicketCode(2)}Download PDF: Stalls, row B, seat 2`,
    ]);
    const download = screen.getByRole('link', { name: 'Download PDF: Stalls, row B, seat 2' });
    expect(download).toHaveAttribute('href', `${API_BASE_URL}/tickets/${fixtureTicketId(2)}/pdf`);
    expect(download).toHaveAttribute('download');
    expect(screen.queryByRole('link', { name: 'Choose tickets again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('lists each general admission ticket on its own line', async () => {
    logInAs(customer);
    const hold = holdOf(meetupSeatMap, { ga: [{ sectionId: LOFT, quantity: 3 }] });
    mockOrder(FIXTURE_ORDER_ID, orderOf(hold, meetup, { status: 'CONFIRMED' }));
    renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Your tickets are confirmed' });

    expect(
      within(screen.getByRole('list', { name: 'Your tickets' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Download PDF: General admission – Loft',
      'Download PDF: General admission – Loft',
      'Download PDF: General admission – Loft',
    ]);
    expect(screen.getByText('$35.00')).toBeInTheDocument();
  });

  it.each(['FAILED', 'EXPIRED'] as const)(
    'offers a %s order’s customer to choose tickets again',
    async (status) => {
      logInAs(customer);
      mockOrder(FIXTURE_ORDER_ID, concertOrder(status));
      renderApp(ORDER_PATH);
      await screen.findByRole('heading', { level: 1 });

      expect(screen.getByRole('link', { name: 'Choose tickets again' })).toHaveAttribute(
        'href',
        '/events/midnight-echoes-live/seats',
      );
      expect(screen.getByRole('link', { name: 'Back to the event' })).toHaveAttribute(
        'href',
        '/events/midnight-echoes-live',
      );
      expect(screen.queryByRole('list', { name: 'Your tickets' })).not.toBeInTheDocument();
      expect(screen.queryByText(/will be refunded/)).not.toBeInTheDocument();
    },
  );

  it('says when a payment arrived too late and is due a refund', async () => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, concertOrder('EXPIRED', { refundDue: true }));
    renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Order expired' });

    expect(
      screen.getByText(/received a payment for this order that it couldn’t use/),
    ).toHaveTextContent('The payment will be refunded.');
  });
});

describe('order status polling', () => {
  it('polls after each response’s retryAfterMs until the order is final', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    const requests = mockOrder(
      FIXTURE_ORDER_ID,
      concertOrder('PROCESSING', { retryAfterMs: 2000 }, { now: NOW }),
      concertOrder('PROCESSING', { retryAfterMs: 5000 }, { now: NOW }),
      concertOrder('CONFIRMED', {}, { now: NOW }),
    );
    renderApp(ORDER_PATH);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Processing your payment');
    });
    expect(requests).toHaveLength(1);

    advanceClock(1900);
    expect(requests).toHaveLength(1);
    advanceClock(200);
    await settleWithFakeClock(() => {
      expect(requests).toHaveLength(2);
    });
    expect((requests[1] ?? 0) - (requests[0] ?? 0)).toBeGreaterThanOrEqual(2000);

    // The second answer asks for 5 seconds.
    advanceClock(4800);
    expect(requests).toHaveLength(2);
    advanceClock(300);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Your tickets are confirmed');
    });
    expect(requests).toHaveLength(3);
    // The change is announced: the heading and message are in the page's live region.
    expect(statusRegion()).toHaveTextContent(/2 tickets for Midnight Echoes Live/);

    // A final status (`retryAfterMs: null`) stops the polling.
    advanceClock(30_000);
    expect(requests).toHaveLength(3);
  });

  it('shows a failed payment as soon as the API reports it', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockOrder(
      FIXTURE_ORDER_ID,
      concertOrder('PENDING_PAYMENT', { retryAfterMs: 1000 }, { now: NOW }),
      concertOrder('FAILED', {}, { now: NOW }),
    );
    renderApp(ORDER_PATH);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Waiting for your payment');
    });

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Payment failed');
    });
    expect(screen.getByRole('link', { name: 'Choose tickets again' })).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('keeps the last status on screen and keeps polling when a poll fails', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    const requests = mockOrder(
      FIXTURE_ORDER_ID,
      concertOrder('PROCESSING', { retryAfterMs: 1000 }, { now: NOW }),
      problemResponse({ status: 503 }),
      concertOrder('CONFIRMED', {}, { now: NOW }),
    );
    renderApp(ORDER_PATH);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Processing your payment');
    });

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(screen.getByText(/couldn’t check for updates/)).toBeInTheDocument();
    });
    expect(heading()).toHaveTextContent('Processing your payment');

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Your tickets are confirmed');
    });
    expect(requests).toHaveLength(3);
    expect(screen.queryByText(/couldn’t check for updates/)).not.toBeInTheDocument();
  });

  it('checks an unpaid order again when its time runs out', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    // 3 seconds left; the API's retryAfterMs is longer, so the countdown triggers the check.
    const pending = concertOrder(
      'PENDING_PAYMENT',
      { retryAfterMs: 60_000 },
      { now: NOW, agoMs: 597_000 },
    );
    const requests = mockOrder(FIXTURE_ORDER_ID, pending, {
      ...pending,
      status: 'EXPIRED',
      paymentUrl: null,
      retryAfterMs: null,
    });
    renderApp(ORDER_PATH);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('timer')).toHaveTextContent('0:03');
    });

    advanceClock(3000);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('Order expired');
    });
    expect(requests).toHaveLength(2);
  });
});

describe('order page links', () => {
  it('links back to the order list', async () => {
    logInAs(customer);
    mockOrder(FIXTURE_ORDER_ID, concertOrder('CONFIRMED'));
    const { user, router } = renderApp(ORDER_PATH);
    await screen.findByRole('heading', { name: 'Your tickets are confirmed' });

    await user.click(screen.getByRole('link', { name: '‹ Your orders' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orders');
    });
  });
});
