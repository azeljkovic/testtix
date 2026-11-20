import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axe } from '../testing/axe.js';
import { renderApp } from '../testing/render.js';

describe('accessibility (axe)', () => {
  it.each([
    ['/', /tickets for concerts/i],
    ['/events', 'Events'],
    ['/no-such-page', 'Page not found'],
  ])('%s has no axe violations', async (path, heading) => {
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: heading });
    // Wait for the API status so axe sees the settled page.
    await screen.findByText('API online');

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
