import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { concertDetail, meetupDetail } from '../testing/catalogue-fixtures.js';
import { server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

type EventDetail = typeof concertDetail;

function mockEvent(event: EventDetail) {
  server.use(http.get(`/api/events/${event.slug}`, () => HttpResponse.json(event)));
}

/** The text of each row of the availability table, cell by cell. */
function tableRows() {
  const table = screen.getByRole('table', { name: 'Ticket availability' });
  return within(table)
    .getAllByRole('row')
    .map((row) =>
      Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent.replace(/\s/g, ' ')),
    );
}

describe('event page', () => {
  it('shows when and where, prices and the sales details', async () => {
    renderApp('/events/midnight-echoes-live');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Midnight Echoes Live' }),
    ).toBeInTheDocument();
    await expect.poll(() => document.title).toBe('Midnight Echoes Live · TestTix');
    expect(screen.getByText('Concert · Reserved seating')).toBeInTheDocument();
    expect(screen.getByText('Midnight Echoes')).toBeInTheDocument();

    const details = screen
      .getAllByRole('definition')
      .map((dd) => dd.textContent.replace(/\s/g, ' '));
    expect(details).toEqual([
      'Sat, Dec 12, 2026, 11:30 PM EST – Sun, Dec 13, 2026, 2:00 AM EST',
      'Riverside Hall1 River Road, Springfield',
      '$59.00 – $89.00',
      'Fri, Oct 23, 2026, 3:00 PM EDT',
      'Up to 6 tickets',
    ]);
    expect(screen.getByText(/A late-night set\.\s+Doors open at 11 PM\./)).toBeInTheDocument();
  });

  it('shows the availability per section, with totals', async () => {
    renderApp('/events/midnight-echoes-live');
    await screen.findByRole('table', { name: 'Ticket availability' });

    expect(tableRows()).toEqual([
      ['Section', 'Type', 'Price', 'Available', 'Held', 'Sold', 'Next release'],
      ['Stalls', 'Seated', '$89.00', '180', '5', '15', 'None'],
      ['Balcony', 'Seated', '$59.00', '0', '0', '0', 'Wed, Nov 25, 2026, 3:00 PM EST'],
      ['All sections', 'Reserved seating', '$59.00 – $89.00', '180', '5', '15', ''],
    ]);
  });

  it('offers "Choose seats" while the event is on sale', async () => {
    const { user, router } = renderApp('/events/midnight-echoes-live');

    const tickets = within(await screen.findByRole('region', { name: 'Tickets' }));
    expect(tickets.getByText('On sale')).toBeInTheDocument();
    expect(tickets.getByText('180 tickets available.')).toBeInTheDocument();

    await user.click(tickets.getByRole('link', { name: 'Choose seats' }));
    expect(router.state.location.pathname).toBe('/events/midnight-echoes-live/seats');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose seats' }),
    ).toBeInTheDocument();
  });

  it('offers "Choose tickets" for a general admission event', async () => {
    renderApp('/events/flaky-tests-clinic');

    const tickets = within(await screen.findByRole('region', { name: 'Tickets' }));
    expect(tickets.getByRole('link', { name: 'Choose tickets' })).toHaveAttribute(
      'href',
      '/events/flaky-tests-clinic/seats',
    );
    expect(tableRows()[1]).toEqual(['Loft', 'General admission', '$10.00', '60', '0', '0', 'None']);
  });

  it.each([
    [
      'SOLD_OUT',
      'Sold out',
      'Every released ticket is sold or held. Held tickets go back on sale if their hold expires.',
    ],
    ['SALES_NOT_OPEN', 'Not on sale yet', 'Tickets aren’t on sale yet.'],
    ['SALES_ENDED', 'Sales ended', 'This event has started, so tickets are no longer sold.'],
  ] as const)('explains why there is nothing to buy when %s', async (availability, badge, text) => {
    mockEvent({ ...concertDetail, availability });
    renderApp('/events/midnight-echoes-live');

    const tickets = within(await screen.findByRole('region', { name: 'Tickets' }));
    expect(tickets.getByText(badge)).toBeInTheDocument();
    expect(tickets.getByText(text)).toBeInTheDocument();
    expect(tickets.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says when more tickets are released', async () => {
    mockEvent({ ...concertDetail, availability: 'SOLD_OUT' });
    renderApp('/events/midnight-echoes-live');

    const tickets = within(await screen.findByRole('region', { name: 'Tickets' }));
    expect(tickets.getByText(/^More tickets are released/)).toHaveTextContent(
      /^More tickets are released Wed, Nov 25, 2026, 3:00\sPM EST\.$/,
    );
  });

  it('says when the first tickets are released', async () => {
    mockEvent({
      ...concertDetail,
      availability: 'SALES_NOT_OPEN',
      tickets: { total: 0, available: 0, held: 0, sold: 0 },
    });
    renderApp('/events/midnight-echoes-live');

    const tickets = within(await screen.findByRole('region', { name: 'Tickets' }));
    expect(tickets.getByText(/released/)).toHaveTextContent(
      /^Tickets are released Wed, Nov 25, 2026, 3:00\sPM EST\.$/,
    );
  });

  it('shows "Event not found" for an unknown or unpublished event', async () => {
    renderApp('/events/no-such-event');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Event not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('shows an error with a way to try again', async () => {
    let fail = true;
    server.use(
      http.get('/api/events/flaky-tests-clinic', () =>
        fail ? problemResponse({ status: 500 }) : HttpResponse.json(meetupDetail),
      ),
    );
    const { user } = renderApp('/events/flaky-tests-clinic');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Flaky Tests Clinic' }),
    ).toBeInTheDocument();
  });

  it('goes back to the list with the search and filters it came from', async () => {
    const { user, router } = renderApp('/events?category=CONCERT&sort=price');

    await user.click(await screen.findByRole('link', { name: 'Midnight Echoes Live' }));
    await screen.findByRole('heading', { level: 1, name: 'Midnight Echoes Live' });
    await user.click(screen.getByRole('link', { name: '‹ Back to events' }));

    expect(router.state.location.pathname).toBe('/events');
    expect(router.state.location.search).toBe('?category=CONCERT&sort=price');
  });

  it('goes back to the plain list when opened directly', async () => {
    renderApp('/events/midnight-echoes-live');

    expect(await screen.findByRole('link', { name: '‹ Back to events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });
});
