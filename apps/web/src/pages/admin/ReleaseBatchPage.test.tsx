import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockAdminRequest } from '../../testing/admin.js';
import {
  adminRiverside,
  cancelledEvent,
  draftEvent,
  publishedEvent,
} from '../../testing/admin-fixtures.js';
import { admin, logInAs } from '../../testing/auth.js';
import { MOCK_CSRF_TOKEN } from '../../testing/msw-server.js';
import { problemResponse } from '../../testing/problems.js';
import { renderApp } from '../../testing/render.js';

const [stalls, balcony, floor] = adminRiverside.sections;

describe('release tickets page', () => {
  it('releases seated sections whole and GA places by number', async () => {
    logInAs(admin);
    const requests = mockAdminRequest(
      'post',
      `/api/admin/events/${draftEvent.id}/batches`,
      () => publishedEvent.batches[0],
    );
    const { user, router } = renderApp(`/admin/events/${draftEvent.id}/batches/new`);

    await user.type(await screen.findByLabelText('Batch name'), 'Early bird');
    await user.type(screen.getByLabelText('Price per ticket (USD)'), '45.50');
    await user.type(screen.getByLabelText('On sale from (optional)'), '2026-12-15T10:00');
    expect(screen.getByLabelText('Stalls')).toHaveAccessibleDescription(
      'Seated · 6 of 6 seats not released yet',
    );
    await user.click(screen.getByLabelText('Stalls'));
    expect(screen.getByLabelText('Floor: places to release')).toHaveAccessibleDescription(
      'General admission · 50 of 50 places not released yet',
    );
    await user.type(screen.getByLabelText('Floor: places to release'), '10');
    await user.click(screen.getByRole('button', { name: 'Release tickets' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Winter Warmers' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/admin/events/${draftEvent.id}`);
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    expect(requests[0]?.body).toEqual({
      name: 'Early bird',
      priceCents: 4550,
      releasesAt: '2026-12-15T15:00:00.000Z',
      seatedSectionIds: [stalls?.id],
      gaSections: [{ sectionId: floor?.id, quantity: 10 }],
    });
  });

  it('releases now when no time is given', async () => {
    logInAs(admin);
    const requests = mockAdminRequest(
      'post',
      `/api/admin/events/${draftEvent.id}/batches`,
      () => publishedEvent.batches[1],
    );
    const { user } = renderApp(`/admin/events/${draftEvent.id}/batches/new`);

    await user.type(await screen.findByLabelText('Batch name'), 'Free balcony');
    await user.type(screen.getByLabelText('Price per ticket (USD)'), '0');
    await user.click(screen.getByLabelText('Balcony'));
    await user.click(screen.getByRole('button', { name: 'Release tickets' }));

    await screen.findByRole('heading', { level: 1, name: 'Winter Warmers' });
    expect(requests[0]?.body).toEqual({
      name: 'Free balcony',
      priceCents: 0,
      seatedSectionIds: [balcony?.id],
    });
  });

  it('only offers what earlier batches left', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${publishedEvent.id}/batches/new`);

    expect(await screen.findByLabelText('Stalls')).toBeDisabled();
    expect(screen.getByLabelText('Stalls')).toHaveAccessibleDescription(
      'Seated · all 6 seats released',
    );
    expect(screen.getByLabelText('Balcony')).toBeDisabled();
    expect(screen.getByLabelText('Floor: places to release')).toHaveAccessibleDescription(
      'General admission · 30 of 50 places not released yet',
    );
  });

  it('checks the price, the quantities and that something is released', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', `/api/admin/events/${publishedEvent.id}/batches`);
    const { user } = renderApp(`/admin/events/${publishedEvent.id}/batches/new`);

    await user.click(await screen.findByRole('button', { name: 'Release tickets' }));
    expect(screen.getByLabelText('Batch name')).toHaveAccessibleDescription(/Enter the name/);
    expect(screen.getByLabelText('Price per ticket (USD)')).toHaveAccessibleDescription(
      /Enter the price/,
    );
    expect(
      screen.getByText('Release at least one seated section, seat or GA place'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Price per ticket (USD)'), '12.345');
    await user.type(screen.getByLabelText('Floor: places to release'), '31');
    await user.click(screen.getByRole('button', { name: 'Release tickets' }));
    expect(screen.getByLabelText('Price per ticket (USD)')).toHaveAccessibleDescription(
      /Enter the price in dollars, e\.g\. 25 or 25\.50/,
    );
    expect(screen.getByLabelText('Floor: places to release')).toHaveAccessibleDescription(
      /Only 30 places are left to release/,
    );
    expect(
      screen.queryByText('Release at least one seated section, seat or GA place'),
    ).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('shows a conflict from the API', async () => {
    logInAs(admin);
    mockAdminRequest('post', `/api/admin/events/${publishedEvent.id}/batches`, () =>
      problemResponse({
        status: 409,
        code: 'GA_CAPACITY_EXCEEDED',
        detail: 'Only 25 places are left to release in Floor.',
      }),
    );
    const { user } = renderApp(`/admin/events/${publishedEvent.id}/batches/new`);

    await user.type(await screen.findByLabelText('Batch name'), 'Late');
    await user.type(screen.getByLabelText('Price per ticket (USD)'), '50');
    await user.type(screen.getByLabelText('Floor: places to release'), '30');
    await user.click(screen.getByRole('button', { name: 'Release tickets' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only 25 places are left to release in Floor.',
    );
  });

  it('refuses a cancelled event', async () => {
    logInAs(admin);
    renderApp(`/admin/events/${cancelledEvent.id}/batches/new`);

    expect(await screen.findByText('A cancelled event can’t get new tickets.')).toBeInTheDocument();
  });
});
