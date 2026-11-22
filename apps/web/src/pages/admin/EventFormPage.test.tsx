import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { mockAdminRequest } from '../../testing/admin.js';
import {
  adminLoft,
  adminRiverside,
  cancelledEvent,
  draftEvent,
  publishedEvent,
} from '../../testing/admin-fixtures.js';
import { admin, logInAs } from '../../testing/auth.js';
import { MOCK_CSRF_TOKEN } from '../../testing/msw-server.js';
import { problemResponse } from '../../testing/problems.js';
import { renderApp } from '../../testing/render.js';

async function fillNewEvent(user: UserEvent) {
  await user.type(await screen.findByLabelText('Title'), 'Winter Warmers');
  await user.type(screen.getByLabelText('Performer'), 'The Mittens');
  await user.type(screen.getByLabelText('Description'), 'Cosy songs for a cold night.');
  await user.selectOptions(screen.getByLabelText('Category'), 'Talk');
  await user.selectOptions(screen.getByLabelText('Venue'), 'Riverside Hall, Springfield');
  await user.type(screen.getByLabelText('Starts'), '2027-01-09T20:00');
  await user.type(screen.getByLabelText('Ends'), '2027-01-09T23:00');
  await user.type(screen.getByLabelText('Sales open'), '2026-12-01T10:00');
}

describe('new event page', () => {
  it('creates a draft, with times in the venue’s time zone', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', '/api/admin/events', () => draftEvent);
    const { user, router } = renderApp('/admin/events/new');

    expect(
      await screen.findByText('Times are in the venue’s time zone. Choose a venue first.'),
    ).toBeInTheDocument();
    await fillNewEvent(user);
    expect(
      screen.getByText('Times are in the venue’s time zone, America/New_York.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tickets per order (optional)'), '4');
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Winter Warmers' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/admin/events/${draftEvent.id}`);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    // 8 PM in New York in January is 1 AM UTC the next day. Empty optional fields are left out.
    expect(requests[0]?.body).toEqual({
      title: 'Winter Warmers',
      performer: 'The Mittens',
      description: 'Cosy songs for a cold night.',
      category: 'TALK',
      venueId: adminRiverside.id,
      startsAt: '2027-01-10T01:00:00.000Z',
      endsAt: '2027-01-10T04:00:00.000Z',
      salesOpenAt: '2026-12-01T15:00:00.000Z',
      maxTicketsPerOrder: 4,
    });
  });

  it('reads the times in the chosen venue’s zone', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', '/api/admin/events', () => draftEvent);
    const { user } = renderApp('/admin/events/new');

    await fillNewEvent(user);
    await user.selectOptions(screen.getByLabelText('Venue'), 'Loft 23, Shelbyville');
    await user.type(screen.getByLabelText('Slug (optional)'), 'warmers-chicago');
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    await screen.findByRole('heading', { level: 1, name: 'Winter Warmers' });
    expect(requests[0]?.body).toMatchObject({
      slug: 'warmers-chicago',
      venueId: adminLoft.id,
      startsAt: '2027-01-10T02:00:00.000Z',
      salesOpenAt: '2026-12-01T16:00:00.000Z',
    });
  });

  it('checks the form with the API’s rules before sending it', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', '/api/admin/events', () => draftEvent);
    const { user } = renderApp('/admin/events/new');

    await user.click(await screen.findByRole('button', { name: 'Create event' }));

    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Enter the title');
    expect(screen.getByLabelText('Performer')).toHaveAccessibleDescription(/Enter the performer/);
    expect(screen.getByLabelText('Venue')).toHaveAccessibleDescription('Choose a venue');
    expect(screen.getByLabelText('Starts')).toHaveAccessibleDescription('Enter the start time');
    expect(screen.getByLabelText('Starts')).toHaveAttribute('aria-invalid', 'true');

    await fillNewEvent(user);
    await user.clear(screen.getByLabelText('Ends'));
    await user.type(screen.getByLabelText('Ends'), '2027-01-09T19:00');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByLabelText('Ends')).toHaveAccessibleDescription(
      'End time must be after the start time',
    );

    await user.type(screen.getByLabelText('Hold duration in seconds (optional)'), '1.5');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(
      screen.getByLabelText('Hold duration in seconds (optional)'),
    ).toHaveAccessibleDescription(/Hold duration must be a whole number/);
    expect(requests).toHaveLength(0);
  });

  it('refuses a time the clocks skip', async () => {
    logInAs(admin);
    const { user } = renderApp('/admin/events/new');

    await fillNewEvent(user);
    await user.clear(screen.getByLabelText('Sales open'));
    await user.type(screen.getByLabelText('Sales open'), '2026-03-08T02:30');
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByLabelText('Sales open')).toHaveAccessibleDescription(
      /This time doesn’t exist in America\/New_York/,
    );
  });

  it('shows the API’s field errors next to the fields', async () => {
    logInAs(admin);
    mockAdminRequest('post', '/api/admin/events', () =>
      problemResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        errors: [{ path: 'startsAt', code: 'custom', message: 'Start time must be in the future' }],
      }),
    );
    const { user } = renderApp('/admin/events/new');

    await fillNewEvent(user);
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    expect(await screen.findByText('Start time must be in the future')).toBeInTheDocument();
    expect(screen.getByLabelText('Starts')).toHaveFocus();
  });

  it('explains a taken slug', async () => {
    logInAs(admin);
    mockAdminRequest('post', '/api/admin/events', () =>
      problemResponse({ status: 409, code: 'SLUG_TAKEN' }),
    );
    const { user } = renderApp('/admin/events/new');

    await fillNewEvent(user);
    await user.type(screen.getByLabelText('Slug (optional)'), 'taken');
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That slug is taken. Choose another, or leave it empty to make one.',
    );
  });
});

describe('edit event page', () => {
  it('shows the event’s values, with times at the venue', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${publishedEvent.id}/edit`);

    expect(await screen.findByLabelText('Title')).toHaveValue('Midnight Echoes Live');
    expect(screen.getByLabelText('Slug (optional)')).toHaveValue('midnight-echoes-live');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-12-12T23:30');
    expect(screen.getByLabelText('Sales open')).toHaveValue('2026-10-23T15:00');
    expect(screen.getByLabelText('Hold duration in seconds (optional)')).toHaveValue('300');
    // Tickets have been released, so the venue is fixed.
    expect(screen.getByLabelText('Venue')).toBeDisabled();
    expect(screen.getByLabelText('Venue')).toHaveAccessibleDescription(
      'The venue can’t change once tickets have been released.',
    );
  });

  it('sends only the fields that changed', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('patch', `/api/admin/events/${publishedEvent.id}`, () => ({
      ...publishedEvent,
      title: 'Midnight Echoes: Encore',
    }));
    const { user, router } = renderApp(`/admin/events/${publishedEvent.id}/edit`);

    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Midnight Echoes: Encore');
    await user.clear(screen.getByLabelText('Ends'));
    await user.type(screen.getByLabelText('Ends'), '2026-12-13T03:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Midnight Echoes: Encore' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/admin/events/${publishedEvent.id}`);
    expect(requests.map((request) => request.body)).toEqual([
      { title: 'Midnight Echoes: Encore', endsAt: '2026-12-13T08:00:00.000Z' },
    ]);
  });

  it('lets a draft without tickets move to another venue', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${draftEvent.id}/edit`);

    const venue = await screen.findByLabelText('Venue');
    expect(venue).toBeEnabled();
    expect(
      within(venue)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a venue', 'Loft 23, Shelbyville', 'Riverside Hall, Springfield']);
  });

  it('doesn’t offer to edit a cancelled event', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${cancelledEvent.id}/edit`);

    expect(await screen.findByText('A cancelled event can’t be changed.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('says when the event doesn’t exist', async () => {
    logInAs(admin);
    renderApp('/admin/events/01970000-0000-7000-8000-000000000999/edit');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Event not found' }),
    ).toBeInTheDocument();
  });
});
