import { screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { admin, customer, logInAs } from '../testing/auth.js';
import { server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

describe('route guards', () => {
  it.each(['/account', '/admin'])(
    'sends an anonymous visitor from %s to the login page and back after logging in',
    async (path) => {
      const { router } = renderApp(`${path}?tab=1`);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login');
      });
      expect(router.state.location.search).toBe(
        `?${new URLSearchParams({ redirectTo: `${path}?tab=1` }).toString()}`,
      );
    },
  );

  it('shows a logged-in user their account', async () => {
    logInAs(customer);
    renderApp('/account');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your account' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ada@example.com', { selector: 'dd' })).toBeInTheDocument();
  });

  it('denies a customer the admin area', async () => {
    logInAs(customer);
    const { router } = renderApp('/admin');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access denied' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
    await expect.poll(() => document.title).toBe('Access denied · TestTix');
  });

  it('lets an admin into the admin area', async () => {
    logInAs(admin);
    const { router } = renderApp('/admin');

    expect(await screen.findByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/events');
  });

  it('shows the loading state, then offers a retry when the session check fails', async () => {
    let calls = 0;
    server.use(
      http.get('/api/auth/me', () => {
        calls += 1;
        return calls === 1 ? problemResponse({ status: 500 }) : problemResponse({ status: 401 });
      }),
    );
    const { user, router } = renderApp('/account');

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We couldn’t check whether you’re logged in.');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
  });
});
