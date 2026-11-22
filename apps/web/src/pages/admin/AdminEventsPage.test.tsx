import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockAdminRequest } from '../../testing/admin.js';
import { adminEvents, draftEvent, eventSummary, page } from '../../testing/admin-fixtures.js';
import { admin, logInAs } from '../../testing/auth.js';
import { problemResponse } from '../../testing/problems.js';
import { renderApp } from '../../testing/render.js';

function tableRows() {
  const table = screen.getByRole('table', { name: 'Events, by start time' });
  return within(table)
    .getAllByRole('row')
    .map((row) =>
      Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent.replace(/\s/g, ' ')),
    );
}

describe('admin event list', () => {
  it('lists every event, drafts and cancelled ones included', async () => {
    logInAs(admin);
    renderApp('/admin/events');

    await screen.findByRole('table', { name: 'Events, by start time' });
    await expect.poll(() => document.title).toBe('Admin: events · TestTix');
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events', current: 'page' })).toBeInTheDocument();
    expect(tableRows()).toEqual([
      ['Event', 'Starts', 'Venue', 'Status', 'Sold / released'],
      [
        'Midnight Echoes LiveMidnight Echoes',
        'Sat, Dec 12, 2026, 11:30 PM EST',
        'Riverside HallSpringfield',
        'Published',
        '5 / 30',
      ],
      [
        'Winter WarmersThe Mittens',
        'Sat, Jan 9, 2027, 8:00 PM EST',
        'Riverside HallSpringfield',
        'Draft',
        '0 / 0',
      ],
      [
        'Rained OffThe Mittens',
        'Sat, Jan 9, 2027, 7:00 PM CST',
        'Loft 23Shelbyville',
        'Cancelled',
        '0 / 0',
      ],
    ]);
    expect(screen.getByRole('link', { name: 'Winter Warmers' })).toHaveAttribute(
      'href',
      `/admin/events/${draftEvent.id}`,
    );
  });

  it('filters by status through the URL', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('get', '/api/admin/events', ({ url }) =>
      url.searchParams.get('status') === 'DRAFT'
        ? page([eventSummary(draftEvent)])
        : page(adminEvents.map(eventSummary)),
    );
    const { user, router } = renderApp('/admin/events');

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Status'), 'Draft');

    await expect.poll(() => tableRows().length).toBe(2);
    expect(router.state.location.search).toBe('?status=DRAFT');
    expect(requests.map(({ url }) => url.search)).toEqual(['?page=1', '?status=DRAFT&page=1']);

    await user.selectOptions(screen.getByLabelText('Status'), 'All statuses');
    await expect.poll(() => tableRows().length).toBe(4);
    expect(router.state.location.search).toBe('');
  });

  it('pages through the list', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('get', '/api/admin/events', ({ url }) =>
      page([eventSummary(draftEvent)], {
        page: Number(url.searchParams.get('page')),
        pageSize: 20,
        total: 41,
      }),
    );
    const { user, router } = renderApp('/admin/events?status=DRAFT&page=2');

    const pagination = within(await screen.findByRole('navigation', { name: 'Pagination' }));
    expect(pagination.getByRole('link', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(pagination.getByRole('link', { name: 'Next page' }));

    expect(router.state.location.search).toBe('?status=DRAFT&page=3');
    await expect.poll(() => requests.at(-1)?.url.search).toBe('?status=DRAFT&page=3');
  });

  it('says when there are no events', async () => {
    logInAs(admin);
    mockAdminRequest('get', '/api/admin/events', () => page([]));
    renderApp('/admin/events?status=CANCELLED');

    expect(await screen.findByText('No cancelled events.')).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    logInAs(admin);
    let calls = 0;
    mockAdminRequest('get', '/api/admin/events', () => {
      calls += 1;
      return calls === 1 ? problemResponse({ status: 500 }) : page([]);
    });
    const { user } = renderApp('/admin/events');

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load the events.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No events yet. Create the first one.')).toBeInTheDocument();
  });
});
