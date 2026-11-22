import { PASSWORD_MIN_LENGTH } from '@testtix/shared';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { csrfHeaderOf, customer, sessionFor } from '../testing/auth.js';
import { MOCK_CSRF_TOKEN, server } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

const newUser = { ...customer, emailVerified: false };

async function fillIn(
  user: ReturnType<typeof renderApp>['user'],
  { name = 'Ada Lovelace', email = 'ada@example.com', password = 'long enough' } = {},
) {
  if (name) await user.type(screen.getByLabelText('Name'), name);
  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('register page', () => {
  it('describes the password rule and validates every field before calling the API', async () => {
    const { user } = renderApp('/register');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAccessibleDescription(`At least ${PASSWORD_MIN_LENGTH} characters.`);

    await fillIn(user, { name: '   ', email: 'not-an-email', password: 'short' });

    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter your name');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter a valid email address',
    );
    expect(password).toHaveAccessibleDescription(
      `At least ${PASSWORD_MIN_LENGTH} characters. Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  });

  it('creates the account and lands on the account page, which asks to verify the email', async () => {
    let body: unknown;
    let csrf: string | null = null;
    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        body = await request.json();
        csrf = csrfHeaderOf(request);
        return HttpResponse.json(sessionFor(newUser), { status: 201 });
      }),
    );
    const { user, router } = renderApp('/register');

    await fillIn(user, { name: '  Ada Lovelace ', email: 'Ada@Example.com' });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account');
    });
    expect(body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'long enough',
    });
    expect(csrf).toBe(MOCK_CSRF_TOKEN);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Verify your email address' }),
    ).toBeVisible();
  });

  it('shows a taken email address on the email field', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        problemResponse({
          status: 409,
          code: 'EMAIL_ALREADY_REGISTERED',
          errors: [
            {
              path: 'email',
              code: 'email_taken',
              message: 'An account with this email already exists',
            },
          ],
        }),
      ),
    );
    const { user, router } = renderApp('/register');

    await fillIn(user);

    const email = screen.getByLabelText('Email');
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription('An account with this email already exists');
    });
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(router.state.location.pathname).toBe('/register');
  });

  it('shows other failures as a form error', async () => {
    server.use(http.post('/api/auth/register', () => problemResponse({ status: 503 })));
    const { user } = renderApp('/register');

    await fillIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong on our side/);
  });

  it('honours a same-origin redirectTo after registering', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(sessionFor(newUser), { status: 201 }),
      ),
    );
    const { user, router } = renderApp('/register?redirectTo=%2Fevents');

    await fillIn(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events');
    });
  });
});
