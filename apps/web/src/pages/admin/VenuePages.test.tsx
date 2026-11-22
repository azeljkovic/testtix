import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockAdminRequest } from '../../testing/admin.js';
import { adminLoft, adminRiverside } from '../../testing/admin-fixtures.js';
import { admin, logInAs } from '../../testing/auth.js';
import { MOCK_CSRF_TOKEN } from '../../testing/msw-server.js';
import { problemResponse } from '../../testing/problems.js';
import { renderApp } from '../../testing/render.js';

describe('venue list', () => {
  it('lists venues with their layouts', async () => {
    logInAs(admin);
    renderApp('/admin/venues');

    const table = await screen.findByRole('table', { name: 'Venues, by name' });
    const rows = within(table)
      .getAllByRole('row')
      .map((row) => Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent));
    expect(rows).toEqual([
      ['Venue', 'Sections', 'Capacity', 'Layout'],
      ['Loft 23Shelbyville · America/Chicago', '1 general admission', '80', 'Editable'],
      [
        'Riverside HallSpringfield · America/New_York',
        '2 seated, 1 general admission',
        '60',
        'Locked',
      ],
    ]);
    expect(within(table).getByRole('link', { name: 'Riverside Hall' })).toHaveAttribute(
      'href',
      `/admin/venues/${adminRiverside.id}`,
    );
  });
});

describe('new venue page', () => {
  it('creates a venue with seated and standing sections', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', '/api/admin/venues', () => adminRiverside);
    const { user, router } = renderApp('/admin/venues/new');

    await user.type(await screen.findByLabelText('Name'), 'Riverside Hall');
    await user.type(screen.getByLabelText('Address'), '1 River Road');
    await user.type(screen.getByLabelText('City'), 'Springfield');
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/New_York');

    const first = within(screen.getByRole('group', { name: 'Section 1' }));
    await user.type(first.getByLabelText('Section name'), 'Stalls');
    await user.type(first.getByLabelText('Rows'), '10');
    await user.type(first.getByLabelText('Seats per row'), '20');

    await user.click(screen.getByRole('button', { name: 'Add general admission section' }));
    const second = within(screen.getByRole('group', { name: 'Section 2' }));
    expect(second.getByLabelText('Section name')).toHaveFocus();
    await user.type(second.getByLabelText('Section name'), 'Floor');
    await user.type(second.getByLabelText('Capacity'), '300');

    await user.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Venues' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/venues');
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    expect(requests[0]?.body).toEqual({
      name: 'Riverside Hall',
      address: '1 River Road',
      city: 'Springfield',
      timezone: 'America/New_York',
      sections: [
        { type: 'SEATED', name: 'Stalls', rows: 10, seatsPerRow: 20 },
        { type: 'GA', name: 'Floor', capacity: 300 },
      ],
    });
  });

  it('checks the layout with the API’s rules', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('post', '/api/admin/venues', () => adminRiverside);
    const { user } = renderApp('/admin/venues/new');

    await user.type(await screen.findByLabelText('Name'), 'Big Barn');
    await user.type(screen.getByLabelText('Address'), 'Farm Road');
    await user.type(screen.getByLabelText('City'), 'Ogdenville');
    await user.clear(screen.getByLabelText('Time zone'));
    await user.type(screen.getByLabelText('Time zone'), 'Mars/Olympus');
    const first = within(screen.getByRole('group', { name: 'Section 1' }));
    await user.type(first.getByLabelText('Rows'), '51');
    await user.type(first.getByLabelText('Seats per row'), 'ten');
    await user.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(screen.getByLabelText('Time zone')).toHaveAccessibleDescription(
      /Enter an IANA time zone, e\.g\. America\/New_York/,
    );
    expect(first.getByLabelText('Section name')).toHaveAccessibleDescription(
      'Enter a section name',
    );
    expect(first.getByLabelText('Rows')).toHaveAccessibleDescription(/Rows must be at most 50/);
    expect(first.getByLabelText('Seats per row')).toHaveAccessibleDescription(
      /Seats per row must be a whole number/,
    );
    expect(requests).toHaveLength(0);
  });

  it('checks the venue’s total capacity', async () => {
    logInAs(admin);
    const { user } = renderApp('/admin/venues/new');

    await user.type(await screen.findByLabelText('Name'), 'Arena');
    await user.type(screen.getByLabelText('Address'), '1 Arena Way');
    await user.type(screen.getByLabelText('City'), 'Capital City');
    const first = within(screen.getByRole('group', { name: 'Section 1' }));
    await user.type(first.getByLabelText('Section name'), 'Bowl');
    await user.type(first.getByLabelText('Rows'), '50');
    await user.type(first.getByLabelText('Seats per row'), '100');
    for (const n of [2, 3, 4, 5]) {
      await user.click(screen.getByRole('button', { name: 'Add general admission section' }));
      const section = within(screen.getByRole('group', { name: `Section ${String(n)}` }));
      await user.type(section.getByLabelText('Section name'), `Floor ${String(n)}`);
      await user.type(section.getByLabelText('Capacity'), '5000');
    }
    await user.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(
      screen.getByText(
        'A venue holds at most 20000 people across all sections (this layout has 25000)',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove section 5' }));
    expect(screen.queryByRole('group', { name: 'Section 5' })).not.toBeInTheDocument();
  });

  it('explains a taken slug', async () => {
    logInAs(admin);
    mockAdminRequest('post', '/api/admin/venues', () =>
      problemResponse({ status: 409, code: 'SLUG_TAKEN' }),
    );
    const { user } = renderApp('/admin/venues/new');

    await user.type(await screen.findByLabelText('Name'), 'Loft');
    await user.type(screen.getByLabelText('Slug (optional)'), 'loft-23');
    await user.type(screen.getByLabelText('Address'), '23 Mill Lane');
    await user.type(screen.getByLabelText('City'), 'Shelbyville');
    const first = within(screen.getByRole('group', { name: 'Section 1' }));
    await user.selectOptions(first.getByLabelText('Type'), 'General admission');
    await user.type(first.getByLabelText('Section name'), 'Loft');
    await user.type(first.getByLabelText('Capacity'), '80');
    await user.click(screen.getByRole('button', { name: 'Create venue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That slug is taken.');
  });
});

describe('edit venue page', () => {
  it('shows a locked layout read-only and saves the other fields', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('patch', `/api/admin/venues/${adminRiverside.id}`, () => ({
      ...adminRiverside,
      city: 'Shelbyville',
    }));
    const { user, router } = renderApp(`/admin/venues/${adminRiverside.id}`);

    const layout = within(await screen.findByRole('group', { name: 'Layout' }));
    expect(
      layout.getByText(
        'Tickets have been released for an event here, so the layout can no longer change.',
      ),
    ).toBeInTheDocument();
    expect(layout.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Stalls: seated, 6 seats',
      'Balcony: seated, 4 seats',
      'Floor: general admission, 50 places',
    ]);
    expect(layout.queryByRole('textbox')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('City'));
    await user.type(screen.getByLabelText('City'), 'Shelbyville');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Venues' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/venues');
    expect(requests.map((request) => request.body)).toEqual([{ city: 'Shelbyville' }]);
  });

  it('replaces an editable layout only when it changed', async () => {
    logInAs(admin);
    const requests = mockAdminRequest(
      'patch',
      `/api/admin/venues/${adminLoft.id}`,
      () => adminLoft,
    );
    const { user } = renderApp(`/admin/venues/${adminLoft.id}`);

    const first = within(await screen.findByRole('group', { name: 'Section 1' }));
    expect(first.getByLabelText('Section name')).toHaveValue('Loft');
    expect(first.getByLabelText('Capacity')).toHaveValue('80');
    await user.clear(first.getByLabelText('Capacity'));
    await user.type(first.getByLabelText('Capacity'), '120');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { level: 1, name: 'Venues' });
    expect(requests.map((request) => request.body)).toEqual([
      { sections: [{ type: 'GA', name: 'Loft', capacity: 120 }] },
    ]);
  });

  it('deletes an unused venue after asking', async () => {
    logInAs(admin);
    const requests = mockAdminRequest('delete', `/api/admin/venues/${adminLoft.id}`);
    const { user, router } = renderApp(`/admin/venues/${adminLoft.id}`);

    await user.click(await screen.findByRole('button', { name: 'Delete venue' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this venue?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete venue' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Venues' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/venues');
    expect(requests).toHaveLength(1);
  });

  it('explains why a venue in use can’t be deleted', async () => {
    logInAs(admin);
    mockAdminRequest('delete', `/api/admin/venues/${adminRiverside.id}`, () =>
      problemResponse({ status: 409, code: 'VENUE_IN_USE' }),
    );
    const { user } = renderApp(`/admin/venues/${adminRiverside.id}`);

    await user.click(await screen.findByRole('button', { name: 'Delete venue' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this venue?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete venue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Events use this venue, so it can’t be deleted.',
    );
  });
});
