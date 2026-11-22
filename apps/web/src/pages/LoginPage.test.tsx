import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { csrfHeaderOf, customer, loggedInResponse, logInAs } from '../testing/auth.js';
import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

async function fillIn(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('login page', () => {
  it('validates the fields before calling the API and focuses the first invalid one', async () => {
    // No POST /api/auth/login handler: a request would fail the test.
    const { user } = renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Log in' });

    await user.click(screen.getByRole('button', { name: 'Log in' }));

    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
    expect(password).toHaveAccessibleDescription('Enter your password');

    await user.type(email, 'ada@example.com');
    expect(email).not.toHaveAttribute('aria-invalid');
  });

  it('logs in with the normalised email and the CSRF token, then returns to redirectTo', async () => {
    let body: unknown;
    let csrf: string | null = null;
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        body = await request.json();
        csrf = csrfHeaderOf(request);
        return loggedInResponse(customer);
      }),
    );
    const { user, router } = renderApp('/login?redirectTo=%2Fevents%3Fpage%3D2');
    await screen.findByRole('link', { name: 'Register' });

    await fillIn(user, '  Ada@Example.com ', ' secret ');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events');
    });
    expect(router.state.location.search).toBe('?page=2');
    expect(body).toEqual({ email: 'ada@example.com', password: ' secret ' });
    expect(csrf).toBe(MOCK_CSRF_TOKEN);
    expect(screen.getByRole('button', { name: 'Ada Lovelace, account menu' })).toBeVisible();
  });

  it('goes to the home page after login when redirectTo leaves the site', async () => {
    server.use(http.post('/api/auth/login', () => loggedInResponse(customer)));
    const { user, router } = renderApp('/login?redirectTo=%2F%2Fevil.example');

    await fillIn(user, 'ada@example.com', 'secret');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('shows wrong credentials as a form error and stays on the page', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        problemResponse({ status: 401, code: 'INVALID_CREDENTIALS' }),
      ),
    );
    const { user, router } = renderApp('/login');

    await fillIn(user, 'ada@example.com', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email address or password is incorrect.',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByLabelText('Password')).toHaveValue('wrong');
  });

  it('maps server field errors to their fields', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        problemResponse({
          status: 400,
          code: 'VALIDATION_ERROR',
          errors: [{ path: 'email', code: 'invalid_format', message: 'Server says no' }],
        }),
      ),
    );
    const { user } = renderApp('/login');

    await fillIn(user, 'ada@example.com', 'secret');

    const email = screen.getByLabelText('Email');
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription('Server says no');
    });
    expect(email).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['the API cannot be reached', () => HttpResponse.error(), /couldn’t reach TestTix/],
    ['the API fails', () => problemResponse({ status: 500 }), /went wrong on our side/],
  ])('shows a form error when %s', async (_case, resolver, message) => {
    server.use(http.post('/api/auth/login', resolver));
    const { user } = renderApp('/login');

    await fillIn(user, 'ada@example.com', 'secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('sends a logged-in visitor on to redirectTo', async () => {
    logInAs(customer);
    const { router } = renderApp('/login?redirectTo=%2Faccount');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account');
    });
  });

  it('links to registration, keeping redirectTo', async () => {
    const { user, router } = renderApp('/login?redirectTo=%2Fevents');

    await user.click(screen.getByRole('link', { name: 'Create an account' }));

    expect(router.state.location.pathname).toBe('/register');
    expect(router.state.location.search).toBe('?redirectTo=%2Fevents');
  });
});
