import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { admin, customer, logInAs } from '../testing/auth.js';
import { server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

const unverified = { ...customer, emailVerified: false };

describe('account page', () => {
  it('lists the user details', async () => {
    logInAs(admin);
    renderApp('/account');

    await screen.findByRole('heading', { level: 1, name: 'Your account' });
    const details = screen.getAllByRole('definition').map((dd) => dd.textContent);
    expect(details).toEqual(['Grace Hopper', 'grace@example.com', 'Verified', 'Admin']);
    expect(
      screen.queryByRole('heading', { name: 'Verify your email address' }),
    ).not.toBeInTheDocument();
  });

  it('asks an unverified user to verify and resends the email', async () => {
    server.use(
      http.post('/api/auth/verify-email/resend', () => new HttpResponse(null, { status: 204 })),
    );
    logInAs(unverified);
    const { user } = renderApp('/account');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Verify your email address' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send a new verification email' }));
    expect(await screen.findByText(/We sent a new link to ada@example.com/)).toBeInTheDocument();
  });

  it('explains when the email cannot be sent', async () => {
    server.use(http.post('/api/auth/verify-email/resend', () => problemResponse({ status: 503 })));
    logInAs(unverified);
    const { user } = renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Send a new verification email' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t send the email right now. Please try again in a few minutes.',
    );
  });

  it('picks up a verification made elsewhere', async () => {
    server.use(
      http.post('/api/auth/verify-email/resend', () => {
        logInAs(customer);
        return problemResponse({ status: 409, code: 'EMAIL_ALREADY_VERIFIED' });
      }),
    );
    logInAs(unverified);
    const { user } = renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Send a new verification email' }));

    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Verify your email address' }),
    ).not.toBeInTheDocument();
  });
});
