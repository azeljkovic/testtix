import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { concert, meetup } from '../testing/catalogue-fixtures.js';
import { holdOf } from '../testing/holds.js';
import { mockOrderList, orderOf, orderPage } from '../testing/orders.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { concertSeatMap, fixtureSeatId, meetupSeatMap } from '../testing/seat-fixtures.js';

const LOFT = '01970000-0000-7000-8000-0000000000b3';
// Midday UTC, so the order date is the same day in every time zone the tests may run in.
const ORDERED_AT = Date.parse('2026-11-20T12:00:00.000Z');

const confirmedConcert = orderOf(
  holdOf(concertSeatMap, { seats: [fixtureSeatId(1, 'B', 1)] }, { createdAt: ORDERED_AT }),
  concert,
  { id: '01970000-0000-7000-8000-000000000c02', status: 'CONFIRMED' },
);
const failedMeetup = orderOf(
  holdOf(meetupSeatMap, { ga: [{ sectionId: LOFT, quantity: 2 }] }, { createdAt: ORDERED_AT }),
  meetup,
  { id: '01970000-0000-7000-8000-000000000c03', status: 'FAILED' },
);

function rows() {
  const table = screen.getByRole('table', { name: 'Your orders, newest first' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
}

describe('your orders', () => {
  it('sends visitors who aren’t logged in to log in first', async () => {
    const { router } = renderApp('/orders');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?redirectTo=%2Forders');
  });

  it('says so when there are no orders yet', async () => {
    logInAs(customer);
    renderApp('/orders');

    expect(await screen.findByText('You haven’t ordered any tickets yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/events');
  });

  it('lists the orders, each linking to its order page', async () => {
    logInAs(customer);
    const pages = mockOrderList(() => orderPage([confirmedConcert, failedMeetup]));
    renderApp('/orders');
    await screen.findByRole('table', { name: 'Your orders, newest first' });

    expect(pages).toEqual([1]);
    expect(document.title).toBe('Your orders · TestTix');
    expect(rows()).toEqual([
      [
        'Midnight Echoes LiveRiverside Hall',
        'Sat, Dec 12, 2026, 11:30 PM EST',
        expect.stringMatching(/^Nov 20, 2026, /),
        '1',
        '$89.00',
        'Confirmed',
      ],
      [
        'Flaky Tests ClinicLoft 23',
        'Sun, Nov 29, 2026, 7:00 PM EST',
        expect.stringMatching(/^Nov 20, 2026, /),
        '2',
        '$20.00',
        'Payment failed',
      ],
    ]);
    expect(screen.getByRole('link', { name: 'Midnight Echoes Live' })).toHaveAttribute(
      'href',
      `/orders/${confirmedConcert.id}`,
    );
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('pages through the orders with ?page', async () => {
    logInAs(customer);
    const pages = mockOrderList((page) =>
      orderPage([failedMeetup], { page, pageSize: 1, total: 2 }),
    );
    const { user } = renderApp('/orders?page=2');
    await screen.findByRole('table');
    expect(pages).toEqual([2]);

    await user.click(screen.getByRole('link', { name: 'Previous page' }));

    await screen.findByRole('link', { name: 'Page 1', current: 'page' });
    expect(pages).toEqual([2, 1]);
  });

  it('offers the first page past the last one', async () => {
    logInAs(customer);
    mockOrderList((page) => orderPage([], { page, total: 3 }));
    renderApp('/orders?page=9');

    expect(await screen.findByText('There’s nothing on this page.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      '/orders',
    );
  });

  it('offers a retry when the list can’t be loaded', async () => {
    logInAs(customer);
    let failed = false;
    mockOrderList(() => {
      if (failed) return orderPage([confirmedConcert]);
      failed = true;
      return problemResponse({ status: 500 });
    });
    const { user } = renderApp('/orders');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We couldn’t load your orders.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Midnight Echoes Live' })).toBeInTheDocument();
  });
});
