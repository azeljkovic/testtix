import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserLocation } from '../app/browser-location.js';
import { axe } from '../testing/axe.js';
import { renderApp } from '../testing/render.js';

// The home page crashes while rendering, the way a bug would.
vi.mock('./HomePage.js', () => ({
  HomePage: () => {
    throw new Error('internal detail: cannot read properties of undefined');
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error page', () => {
  it('replaces a page that fails to render, inside the layout, without the details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderApp('/');

    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' });
    expect(document.title).toBe('Something went wrong · TestTix');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('The page failed to render', expect.any(Error));

    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
    await screen.findByText('API online');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('reloads the page on request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.spyOn(browserLocation, 'reload').mockImplementation(() => undefined);
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Reload the page' }));

    expect(reload).toHaveBeenCalledOnce();
  });
});
