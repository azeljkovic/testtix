import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../testing/render.js';

describe('app shell', () => {
  it('renders the header, main navigation, main content and footer landmarks', async () => {
    renderApp('/');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: /tickets for concerts/i }),
    ).toBeInTheDocument();
  });

  it('offers a skip link as the first tab stop that moves focus to the main content', async () => {
    const { user } = renderApp('/');

    await user.tab();
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skipLink).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('sets the document title per route', async () => {
    const { router } = renderApp('/');
    await expect.poll(() => document.title).toBe('TestTix');

    await router.navigate('/events');
    await expect.poll(() => document.title).toBe('Events · TestTix');
  });

  it('navigates with the main navigation and marks the current page', async () => {
    const { user, router } = renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    await user.click(within(nav).getByRole('link', { name: 'Events' }));

    expect(router.state.location.pathname).toBe('/events');
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a 404 page for unknown routes, with a link back home', async () => {
    const { user, router } = renderApp('/no-such-page');

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    await expect.poll(() => document.title).toBe('Page not found · TestTix');

    await user.click(screen.getByRole('link', { name: 'Go to the home page' }));
    expect(router.state.location.pathname).toBe('/');
  });
});
