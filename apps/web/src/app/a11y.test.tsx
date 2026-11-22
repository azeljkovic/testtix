import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { admin, customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
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
    ['/events', 'Events'],
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

  it('the admin and access denied pages have no axe violations', async () => {
    logInAs(admin);
    const first = renderApp('/admin');
    await screen.findByRole('heading', { level: 1, name: 'Admin' });
    await settled();
    expect(await axe(document.body)).toHaveNoViolations();
    first.unmount();

    logInAs(customer);
    renderApp('/admin');
    await screen.findByRole('heading', { level: 1, name: 'Access denied' });
    await settled();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
