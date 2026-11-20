import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../testing/msw-server.js';
import { renderApp } from '../testing/render.js';

describe('API status in the footer', () => {
  it('reports the API as online when GET /api/health succeeds', async () => {
    renderApp('/');

    expect(screen.getByText('Checking API…')).toBeInTheDocument();
    expect(await screen.findByText('API online')).toBeInTheDocument();
  });

  it('reports the API as offline when it returns an error', async () => {
    server.use(
      http.get('/api/health', () =>
        HttpResponse.json({ status: 503 }, { status: 503, statusText: 'Service Unavailable' }),
      ),
    );
    renderApp('/');

    expect(await screen.findByText('API offline')).toBeInTheDocument();
  });

  it('reports the API as offline when it cannot be reached', async () => {
    server.use(http.get('/api/health', () => HttpResponse.error()));
    renderApp('/');

    expect(await screen.findByText('API offline')).toBeInTheDocument();
  });
});
