import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { csrfHeaderOf, customer, logInAs } from '../testing/auth.js';
import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

const unverified = { ...customer, emailVerified: false };

describe('verify email page', () => {
  it('verifies the token from the link once and refreshes the session', async () => {
    const requests: { body: unknown; csrf: string | null }[] = [];
    server.use(
      http.post('/api/auth/verify-email', async ({ request }) => {
        requests.push({ body: await request.json(), csrf: csrfHeaderOf(request) });
        // From now on the user is verified.
        logInAs(customer);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    logInAs(unverified);
    const { user } = renderApp('/verify-email?token=abc123');

    expect(screen.getByRole('status')).toHaveTextContent('Verifying your email address…');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email verified' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([{ body: { token: 'abc123' }, csrf: MOCK_CSRF_TOKEN }]);

    await user.click(screen.getByRole('button', { name: 'Ada Lovelace, account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Account' }));
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it('explains an incomplete link without calling the API', async () => {
    renderApp('/verify-email');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Verification link incomplete' }),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('main')).findByRole('link', { name: 'Log in' }),
    ).toHaveAttribute('href', '/login?redirectTo=%2Faccount');
  });

  it('asks an anonymous visitor with an expired link to log in for a new one', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        problemResponse({ status: 400, code: 'VERIFICATION_TOKEN_EXPIRED' }),
      ),
    );
    renderApp('/verify-email?token=old');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification link expired' }),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('main')).findByRole('link', { name: 'Log in' }),
    ).toHaveAttribute('href', '/login?redirectTo=%2Faccount');
  });

  it('lets a logged-in user with a replaced link send a new email', async () => {
    let resent = 0;
    server.use(
      http.post('/api/auth/verify-email', () =>
        problemResponse({ status: 400, code: 'VERIFICATION_TOKEN_INVALID' }),
      ),
      http.post('/api/auth/verify-email/resend', () => {
        resent += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    logInAs(unverified);
    const { user } = renderApp('/verify-email?token=replaced');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification link not valid' }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Send a new verification email' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'We sent a new link to ada@example.com. Links in earlier emails no longer work.',
      );
    });
    expect(resent).toBe(1);
  });

  it('tells a verified user there is nothing more to do', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        problemResponse({ status: 400, code: 'VERIFICATION_TOKEN_INVALID' }),
      ),
    );
    logInAs(customer);
    renderApp('/verify-email?token=replaced');

    expect(await screen.findByText(/already verified/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send a new verification email' }),
    ).not.toBeInTheDocument();
  });

  it('offers to try again when the API fails', async () => {
    let calls = 0;
    server.use(
      http.post('/api/auth/verify-email', () => {
        calls += 1;
        return calls === 1
          ? problemResponse({ status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderApp('/verify-email?token=abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong on our side/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email verified' }),
    ).toBeInTheDocument();
  });
});
