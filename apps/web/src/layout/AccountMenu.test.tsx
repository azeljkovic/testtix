import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { admin, csrfHeaderOf, customer, logInAs, logOut } from '../testing/auth.js';
import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import { renderApp } from '../testing/render.js';

describe('account menu', () => {
  it('offers log in and register to visitors, returning to the current page', async () => {
    renderApp('/events');
    const header = screen.getByRole('banner');

    expect(await within(header).findByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?redirectTo=%2Fevents',
    );
    expect(within(header).getByRole('link', { name: 'Register' })).toHaveAttribute(
      'href',
      '/register?redirectTo=%2Fevents',
    );
  });

  it('shows a customer the account page and log out, but not admin', async () => {
    logInAs(customer);
    const { user, router } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Ada Lovelace, account menu' }));

    expect(screen.getByText('Logged in as ada@example.com')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Account', 'Log out']);

    await user.click(screen.getByRole('menuitem', { name: 'Account' }));
    expect(router.state.location.pathname).toBe('/account');
  });

  it('shows an admin the admin area', async () => {
    logInAs(admin);
    const { user, router } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Grace Hopper, account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Admin' }));

    expect(router.state.location.pathname).toBe('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin' })).toBeInTheDocument();
  });

  it('logs out from a guarded page to the home page', async () => {
    let csrf: string | null = null;
    server.use(
      http.post('/api/auth/logout', ({ request }) => {
        csrf = csrfHeaderOf(request);
        logOut();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    logInAs(customer);
    const { user, router } = renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Ada Lovelace, account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(
      await within(screen.getByRole('banner')).findByRole('link', { name: 'Log in' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(csrf).toBe(MOCK_CSRF_TOKEN);
  });

  it('stays logged in and says so when logging out fails', async () => {
    server.use(http.post('/api/auth/logout', () => HttpResponse.error()));
    logInAs(customer);
    const { user } = renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Ada Lovelace, account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t log out. Try again.');
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeInTheDocument();
    });
  });
});
