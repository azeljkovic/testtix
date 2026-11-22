import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { adminRiverside, draftEvent, publishedEvent } from '../testing/admin-fixtures.js';
import { admin, customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { mockEventList } from '../testing/catalogue.js';
import { concert, eventPage } from '../testing/catalogue-fixtures.js';
import { server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

/** Waits for the API status and the account area in the header, so axe sees the settled page. */
async function settled() {
  await screen.findByText('API online');
  const header = within(screen.getByRole('banner'));
  await waitFor(() => {
    expect(
      header.queryByRole('link', { name: 'Log in' }) ??
        header.queryByRole('button', { name: /account menu/ }),
    ).toBeInTheDocument();
  });
}

describe('accessibility (axe)', () => {
  it.each([
    ['/', /tickets for concerts/i],
    ['/no-such-page', 'Page not found'],
    ['/login', 'Log in'],
    ['/register', 'Create an account'],
    ['/verify-email', 'Verification link incomplete'],
  ])('%s has no axe violations', async (path, heading) => {
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: heading });
    await settled();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it.each([
    ['/login', 'Log in'],
    ['/register', 'Create account'],
  ])('the %s form has no axe violations while showing errors', async (path, submit) => {
    const { user } = renderApp(path);
    await settled();

    await user.click(screen.getByRole('button', { name: submit }));
    await screen.findAllByText(/^Enter /);

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the login form has no axe violations with a form-level error', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        problemResponse({ status: 401, code: 'INVALID_CREDENTIALS' }),
      ),
    );
    const { user } = renderApp('/login');
    await settled();

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the account page and open account menu have no axe violations', async () => {
    logInAs({ ...customer, emailVerified: false });
    const { user } = renderApp('/account');
    await screen.findByRole('heading', { level: 1, name: 'Your account' });
    await settled();
    expect(await axe(document.body)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Ada Lovelace, account menu' }));
    await screen.findByRole('menu');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it.each([
    ['an expired verification link', 'VERIFICATION_TOKEN_EXPIRED', 'Verification link expired'],
    ['a replaced verification link', 'VERIFICATION_TOKEN_INVALID', 'Verification link not valid'],
  ] as const)('the page for %s has no axe violations', async (_case, code, heading) => {
    server.use(http.post('/api/auth/verify-email', () => problemResponse({ status: 400, code })));
    logInAs({ ...customer, emailVerified: false });
    renderApp('/verify-email?token=x');
    await screen.findByRole('heading', { level: 1, name: heading });
    await screen.findByRole('button', { name: 'Send a new verification email' });
    await settled();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the access denied page has no axe violations', async () => {
    logInAs(customer);
    renderApp('/admin');
    await screen.findByRole('heading', { level: 1, name: 'Access denied' });
    await settled();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  describe('admin', () => {
    it.each([
      ['/admin/events', 'Events', 'Midnight Echoes Live'],
      [`/admin/events/${publishedEvent.id}`, 'Midnight Echoes Live', 'Early bird'],
      ['/admin/events/new', 'New event', 'Title'],
      [`/admin/events/${publishedEvent.id}/edit`, 'Edit event', 'Title'],
      [`/admin/events/${publishedEvent.id}/batches/new`, 'Release tickets', 'Batch name'],
      ['/admin/venues', 'Venues', 'Riverside Hall'],
      ['/admin/venues/new', 'New venue', 'Section name'],
      [`/admin/venues/${adminRiverside.id}`, 'Riverside Hall', 'Name'],
    ])('%s has no axe violations', async (path, heading, loaded) => {
      logInAs(admin);
      renderApp(path);
      await screen.findByRole('heading', { level: 1, name: heading });
      await screen.findAllByText(loaded);
      await settled();
      expect(await axe(document.body)).toHaveNoViolations();
    });

    it('the confirmation dialog has no axe violations', async () => {
      logInAs(admin);
      const { user } = renderApp(`/admin/events/${draftEvent.id}`);
      await settled();
      await user.click(await screen.findByRole('button', { name: 'Cancel event' }));
      await screen.findByRole('alertdialog', { name: 'Cancel this event?' });
      expect(await axe(document.body)).toHaveNoViolations();
    });
  });

  describe('catalogue', () => {
    /** Waits for the list's status to settle on `status`. */
    async function listSettled(status: RegExp | string) {
      await screen.findByRole('heading', { level: 1, name: 'Events' });
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(status);
      });
      // The venue filter's choices.
      await screen.findByRole('option', { name: 'Riverside Hall, Springfield' });
      await settled();
    }

    it('the event list with results and pagination has no axe violations', async () => {
      mockEventList(() => eventPage([concert], { page: 2, total: 45 }));
      renderApp('/events?q=echo&page=2');
      await listSettled('Showing 21–21 of 45 events');
      await screen.findByRole('navigation', { name: 'Pagination' });

      expect(await axe(document.body)).toHaveNoViolations();
    });

    it.each([
      ['loading', '/events', () => new Promise<never>(() => undefined), 'Loading events…'],
      ['empty', '/events?category=TALK', () => eventPage([]), 'No events found'],
      ['failed', '/events', () => problemResponse({ status: 503 }), ''],
      ['past the last page', '/events?page=9', () => eventPage([], { total: 45 }), '45 events'],
    ] as const)('the %s event list has no axe violations', async (_case, path, respond, status) => {
      mockEventList(respond);
      renderApp(path);
      await listSettled(status);
      if (_case === 'failed') await screen.findByRole('alert');

      expect(await axe(document.body)).toHaveNoViolations();
    });

    it('the event list with an invalid date range has no axe violations', async () => {
      renderApp('/events?from=2026-12-10&to=2026-12-01');
      await listSettled('Fix the dates to see events.');

      expect(await axe(document.body)).toHaveNoViolations();
    });

    it.each([
      ['/events/midnight-echoes-live', 'Midnight Echoes Live'],
      ['/events/flaky-tests-clinic', 'Flaky Tests Clinic'],
      ['/events/no-such-event', 'Event not found'],
      ['/events/midnight-echoes-live/seats', 'Choose seats'],
    ])('%s has no axe violations', async (path, heading) => {
      renderApp(path);
      await screen.findByRole('heading', { level: 1, name: heading });
      await settled();

      expect(await axe(document.body)).toHaveNoViolations();
    });
  });
});
