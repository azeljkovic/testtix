import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockAdminRequest } from '../../testing/admin.js';
import { cancelledEvent, draftEvent, publishedEvent } from '../../testing/admin-fixtures.js';
import { admin, logInAs } from '../../testing/auth.js';
import { MOCK_CSRF_TOKEN } from '../../testing/msw-server.js';
import { problemResponse } from '../../testing/problems.js';
import { renderApp } from '../../testing/render.js';

/** The text of each row of the batches table, cell by cell. */
function batchRows() {
  const table = screen.getByRole('table', { name: 'Ticket batches' });
  return within(table)
    .getAllByRole('row')
    .map((row) =>
      Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent.replace(/\s/g, ' ')),
    );
}

describe('admin event page', () => {
  it('shows the details and batches with their ticket counts', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${publishedEvent.id}`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Midnight Echoes Live' }),
    ).toBeInTheDocument();
    await expect.poll(() => document.title).toBe('Midnight Echoes Live · TestTix');
    expect(screen.getByText('Published')).toBeInTheDocument();
    const details = screen
      .getAllByRole('definition')
      .map((dd) => dd.textContent.replace(/\s/g, ' '));
    expect(details).toEqual([
      'Concert',
      'Sat, Dec 12, 2026, 11:30 PM EST – Sun, Dec 13, 2026, 2:00 AM EST',
      'Riverside Hall, Springfield',
      'Fri, Oct 23, 2026, 3:00 PM EDT',
      '/events/midnight-echoes-live',
      '5 minutes',
      'Up to 4',
      'Off',
      '30 released: 23 available, 2 held, 5 sold',
    ]);
    expect(batchRows()).toEqual([
      ['Batch', 'Price', 'On sale from', 'Sections', 'Tickets', 'Available', 'Held', 'Sold'],
      [
        'Early bird',
        '$45.00',
        'Fri, Oct 23, 2026, 3:00 PM EDT',
        'Stalls (6), Floor (20)',
        '26',
        '19',
        '2',
        '5',
      ],
      [
        'Balcony',
        '$25.00',
        'Tue, Dec 1, 2026, 10:00 AM ESTScheduled',
        'Balcony (4)',
        '4',
        '4',
        '0',
        '0',
      ],
    ]);
    expect(screen.getByRole('link', { name: 'View in catalogue' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live',
    );
  });

  it('publishes a draft', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', `/api/admin/events/${draftEvent.id}/publish`, () => ({
      ...draftEvent,
      status: 'PUBLISHED',
    }));
    const { user } = renderApp(`/admin/events/${draftEvent.id}`);

    expect(
      await screen.findByText('Release a batch of tickets before publishing.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText('Published. The event is now in the public catalogue.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Published', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete event' })).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
  });

  it('explains why an event can’t be published', async () => {
    logInAs(admin);
    mockAdminRequest('post', `/api/admin/events/${draftEvent.id}/publish`, () =>
      problemResponse({
        status: 409,
        code: 'EVENT_HAS_NO_BATCHES',
        detail: 'Release at least one ticket batch before publishing the event.',
      }),
    );
    const { user } = renderApp(`/admin/events/${draftEvent.id}`);

    await user.click(await screen.findByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Release at least one ticket batch before publishing the event.',
    );
    expect(screen.getByText('Draft', { selector: 'span' })).toBeInTheDocument();
  });

  it('unpublishes a published event', async () => {
    logInAs(admin);
    mockAdminRequest('post', `/api/admin/events/${publishedEvent.id}/unpublish`, () => ({
      ...publishedEvent,
      status: 'DRAFT',
    }));
    const { user } = renderApp(`/admin/events/${publishedEvent.id}`);

    await user.click(await screen.findByRole('button', { name: 'Unpublish' }));

    expect(
      await screen.findByText(
        'Unpublished. The event is a draft again and has left the catalogue.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('asks before cancelling', async () => {
    logInAs(admin);
    const requests = mockAdminRequest(
      'post',
      `/api/admin/events/${publishedEvent.id}/cancel`,
      () => ({ ...publishedEvent, status: 'CANCELLED' }),
    );
    const { user } = renderApp(`/admin/events/${publishedEvent.id}`);

    await user.click(await screen.findByRole('button', { name: 'Cancel event' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Cancel this event?' });
    expect(dialog).toHaveTextContent('It stays visible to people who bought tickets.');
    expect(within(dialog).getByRole('button', { name: 'Keep event' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Keep event' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Cancel event' }));
    dialog = screen.getByRole('alertdialog', { name: 'Cancel this event?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel event' }));

    expect(
      await screen.findByText('Cancelled. The event can no longer be changed.'),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Release tickets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument();
  });

  it('deletes a draft after asking', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('delete', `/api/admin/events/${draftEvent.id}`);
    const { user, router } = renderApp(`/admin/events/${draftEvent.id}`);

    await user.click(await screen.findByRole('button', { name: 'Delete event' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this event?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete event' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/events');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
  });

  it('offers no changes to a cancelled event', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${cancelledEvent.id}`);

    await screen.findByRole('heading', { level: 1, name: 'Rained Off' });
    expect(screen.getByText('Cancelled', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('No tickets released yet.')).toBeInTheDocument();
  });

  it('says when the event doesn’t exist', async () => {
    logInAs(admin);
    renderApp('/admin/events/01970000-0000-7000-8000-000000000999');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Event not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to all events' })).toHaveAttribute(
      'href',
      '/admin/events',
    );
  });
});
