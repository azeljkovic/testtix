import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { mockEventList } from '../testing/catalogue.js';
import { concert, eventPage, meetup } from '../testing/catalogue-fixtures.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

const onSaleList = () => screen.findByRole('list', { name: 'On sale now' });

describe('home page', () => {
  it('shows the next events on sale, soonest first', async () => {
    const requests = mockEventList(() => eventPage([meetup, concert]));
    renderApp('/');

    const list = within(await onSaleList());
    expect(
      list.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Flaky Tests Clinic', 'Midnight Echoes Live']);
    expect(list.getByRole('link', { name: 'Midnight Echoes Live' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live',
    );
    expect(Object.fromEntries(requests[0] ?? [])).toEqual({
      availability: 'ON_SALE',
      sort: 'date',
      order: 'asc',
      pageSize: '3',
    });
    expect(screen.getByRole('link', { name: 'See all events on sale' })).toHaveAttribute(
      'href',
      '/events?availability=ON_SALE',
    );
  });

  it('says so when nothing is on sale', async () => {
    mockEventList();
    renderApp('/');

    expect(
      await screen.findByText('No events are on sale right now. Check back soon.'),
    ).toBeInTheDocument();
  });

  it('points to the event list when the events don’t load', async () => {
    mockEventList(() => problemResponse({ status: 500 }));
    renderApp('/');

    expect(await screen.findByText(/We couldn’t load the events just now/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('links each category to the filtered event list', async () => {
    const { user, router } = renderApp('/');
    const categories = within(screen.getByRole('region', { name: 'Browse by category' }));

    expect(categories.getByRole('link', { name: 'Concerts' })).toHaveAttribute(
      'href',
      '/events?category=CONCERT',
    );
    expect(categories.getByRole('link', { name: 'Meetups' })).toHaveAttribute(
      'href',
      '/events?category=MEETUP',
    );
    await user.click(categories.getByRole('link', { name: 'Talks' }));

    expect(router.state.location.pathname).toBe('/events');
    expect(router.state.location.search).toBe('?category=TALK');
    expect(await screen.findByRole('combobox', { name: 'Category' })).toHaveTextContent('Talk');
  });

  it('explains the three steps of buying tickets', () => {
    renderApp('/');
    const steps = within(screen.getByRole('region', { name: 'How it works' }));

    expect(
      steps.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Pick your seats', 'Hold them while you pay', 'Get your e-tickets']);
  });

  it('offers to create an account only to visitors who aren’t logged in', async () => {
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('leaves the account button out for logged-in users', async () => {
    logInAs(customer);
    renderApp('/');

    expect(await screen.findByRole('button', { name: /account menu/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderApp('/');
    await onSaleList();

    expect(await axe(container)).toHaveNoViolations();
  });
});
