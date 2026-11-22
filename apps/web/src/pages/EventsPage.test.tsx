import { SEARCH_DEBOUNCE_MS } from '@testtix/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockEventList } from '../testing/catalogue.js';
import { concert, eventPage, meetup, preview } from '../testing/catalogue-fixtures.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';

/** Waits until the list shows its results (or empty state) for the current URL. */
async function resultsLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('status')).not.toHaveTextContent('Loading events…');
  });
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search' });
const select = (name: string) => screen.getByRole('combobox', { name });

describe('event list', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists events with their date, venue, price and availability', async () => {
    renderApp('/events');

    const link = await screen.findByRole('link', { name: 'Midnight Echoes Live' });
    expect(link).toHaveAttribute('href', '/events/midnight-echoes-live');
    const card = within(screen.getByRole('article', { name: 'Midnight Echoes Live' }));
    expect(card.getByText('Concert · Reserved seating')).toBeInTheDocument();
    expect(card.getByText('Midnight Echoes')).toBeInTheDocument();
    // In the venue's time zone (New York), not the browser's.
    expect(card.getByText(/^Sat, Dec 12, 2026, 11:30\sPM EST$/)).toHaveAttribute(
      'datetime',
      concert.startsAt,
    );
    expect(card.getByText('Riverside Hall, Springfield')).toBeInTheDocument();
    expect(card.getByText('$59.00 – $89.00')).toBeInTheDocument();
    expect(card.getByText('On sale')).toBeInTheDocument();

    const preview = within(screen.getByRole('article', { name: 'Summer Sounds Preview' }));
    expect(preview.getByText('Not on sale yet')).toBeInTheDocument();
    expect(preview.getByText('Free – $25.00')).toBeInTheDocument();

    expect(screen.getByRole('status')).toHaveTextContent('Showing 1–3 of 3 events');
    expect(
      within(screen.getByRole('list', { name: 'Results' }))
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Flaky Tests Clinic', 'Midnight Echoes Live', 'Summer Sounds Preview']);
  });

  it('shows a loading state until the events arrive', async () => {
    let respond: (() => void) | undefined;
    mockEventList(
      () =>
        new Promise((resolve) => {
          respond = () => {
            resolve(eventPage([concert]));
          };
        }),
    );
    renderApp('/events');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading events…');
    expect(screen.queryByRole('list', { name: 'Results' })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(respond).toBeDefined();
    });
    respond?.();
    expect(await screen.findByRole('link', { name: 'Midnight Echoes Live' })).toBeInTheDocument();
  });

  it('sends the URL’s filters to the API and shows them in the controls', async () => {
    const requests = mockEventList(() => eventPage([concert], { page: 2, total: 21 }));
    renderApp(
      '/events?q=echo&category=CONCERT&venue=riverside-hall&seating=SEATED&availability=ON_SALE&sort=price&order=desc&page=2',
    );
    await screen.findByRole('link', { name: 'Midnight Echoes Live' });

    expect(Object.fromEntries(requests[0] ?? [])).toEqual({
      q: 'echo',
      category: 'CONCERT',
      venue: 'riverside-hall',
      seating: 'SEATED',
      availability: 'ON_SALE',
      sort: 'price',
      order: 'desc',
      page: '2',
      pageSize: '20',
    });
    expect(searchBox()).toHaveValue('echo');
    expect(select('Category')).toHaveValue('CONCERT');
    await waitFor(() => {
      expect(select('Venue')).toHaveDisplayValue('Riverside Hall, Springfield');
    });
    expect(select('Seating')).toHaveDisplayValue('Reserved seating');
    expect(select('Availability')).toHaveDisplayValue('On sale');
    expect(select('Sort by')).toHaveDisplayValue('Price, highest first');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 21–21 of 21 events');
  });

  it('ignores values in the URL that the API wouldn’t accept', async () => {
    const requests = mockEventList(() => eventPage([concert]));
    renderApp('/events?category=PARTY&page=0&sort=popularity&from=2026-02-30');
    await screen.findByRole('link', { name: 'Midnight Echoes Live' });

    expect(Object.fromEntries(requests[0] ?? [])).toEqual({
      sort: 'date',
      order: 'asc',
      page: '1',
      pageSize: '20',
    });
    expect(select('Category')).toHaveValue('');
  });

  it('puts a filter change in the URL, goes back to page 1 and lets the back button undo it', async () => {
    const requests = mockEventList((query) =>
      eventPage([concert], { page: Number(query.get('page')), total: 45 }),
    );
    const { user, router } = renderApp('/events?page=2');
    await screen.findByRole('link', { name: 'Midnight Echoes Live' });

    await user.selectOptions(select('Category'), 'Talk');

    expect(router.state.location.search).toBe('?category=TALK');
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(requests[1]?.get('category')).toBe('TALK');
    expect(requests[1]?.get('page')).toBe('1');

    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('?page=2');
    expect(select('Category')).toHaveValue('');
    expect(await screen.findByRole('status')).toHaveTextContent('Showing 21–21 of 45 events');
  });

  it('changes the sort', async () => {
    const requests = mockEventList(() => eventPage([concert]));
    const { user, router } = renderApp('/events');
    await resultsLoaded();

    await user.selectOptions(select('Sort by'), 'Name, Z to A');

    expect(router.state.location.search).toBe('?sort=name&order=desc');
    await waitFor(() => {
      expect(requests.at(-1)?.get('sort')).toBe('name');
    });
    expect(requests.at(-1)?.get('order')).toBe('desc');
  });

  it('filters by a range of days, in local time, with the last day included', async () => {
    const requests = mockEventList(() => eventPage([concert]));
    const { user, router } = renderApp('/events');
    await resultsLoaded();

    await user.type(screen.getByLabelText('From'), '2026-12-01');
    await user.type(screen.getByLabelText('To'), '2026-12-31');

    expect(router.state.location.search).toBe('?from=2026-12-01&to=2026-12-31');
    await waitFor(() => {
      expect(requests.at(-1)?.get('to')).toBe(new Date(2027, 0, 1).toISOString());
    });
    expect(requests.at(-1)?.get('from')).toBe(new Date(2026, 11, 1).toISOString());
  });

  it('explains a date range that ends before it starts, without searching', async () => {
    const requests = mockEventList(() => eventPage([concert]));
    renderApp('/events?from=2026-12-10&to=2026-12-01');

    const to = await screen.findByLabelText('To');
    expect(to).toBeInvalid();
    expect(to).toHaveAccessibleDescription('The “To” date can’t be before the “From” date');
    expect(screen.getByRole('status')).toHaveTextContent('Fix the dates to see events.');
    expect(requests).toHaveLength(0);
  });

  it('clears the search and filters but keeps the sort', async () => {
    mockEventList(() => eventPage([concert]));
    const { user, router } = renderApp('/events?q=echo&category=TALK&sort=name&page=3');
    await resultsLoaded();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(router.state.location.search).toBe('?sort=name');
    expect(searchBox()).toHaveValue('');
    expect(select('Category')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('says when no events match the filters', async () => {
    mockEventList();
    renderApp('/events?category=TALK');

    expect(await screen.findByText('No events match your search and filters.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No events found');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('says when there are no events at all', async () => {
    mockEventList();
    renderApp('/events');

    expect(
      await screen.findByText('No events are on sale yet. Check back soon.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows an error with a way to try again', async () => {
    let fail = true;
    mockEventList(() => (fail ? problemResponse({ status: 503 }) : eventPage([meetup])));
    const { user } = renderApp('/events');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t load the events. Something went wrong on our side. Please try again.',
    );

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Flaky Tests Clinic' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('search', () => {
    it(`searches ${String(SEARCH_DEBOUNCE_MS)} ms after the last keystroke, once`, async () => {
      const requests = mockEventList((query) =>
        eventPage(query.has('q') ? [concert] : [concert, meetup, preview]),
      );
      const { router } = renderApp('/events');
      await screen.findByRole('link', { name: 'Flaky Tests Clinic' });
      expect(requests).toHaveLength(1);

      // Only the timers the debounce uses. Typing goes through `fireEvent`: user-event's async
      // wrapper waits on a real `setTimeout`, which fake timers would never fire.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.change(searchBox(), { target: { value: 'ech' } });
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      });
      // Another keystroke before the pause is over starts the wait again.
      fireEvent.change(searchBox(), { target: { value: 'echo' } });
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      });
      expect(router.state.location.search).toBe('');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(router.state.location.search).toBe('?q=echo');
      act(() => {
        vi.runOnlyPendingTimers();
      });
      vi.useRealTimers();

      await waitFor(() => {
        expect(screen.queryByRole('link', { name: 'Flaky Tests Clinic' })).not.toBeInTheDocument();
      });
      expect(requests.map((query) => query.get('q'))).toEqual([null, 'echo']);
    });

    it('searches at once on Enter, and goes back to page 1', async () => {
      const requests = mockEventList(() => eventPage([concert], { total: 45 }));
      const { user, router } = renderApp('/events?page=2');
      await resultsLoaded();

      await user.type(searchBox(), '  echo {Enter}');

      expect(router.state.location.search).toBe('?q=echo');
      await waitFor(() => {
        expect(requests.at(-1)?.get('q')).toBe('echo');
      });
      // The debounce timer finds the search already done and adds no second history entry.
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
      expect(requests.filter((query) => query.get('q') === 'echo')).toHaveLength(1);
      await act(() => router.navigate(-1));
      expect(router.state.location.search).toBe('?page=2');
    });

    it('follows the URL when the back button undoes a search', async () => {
      mockEventList(() => eventPage([concert]));
      const { user, router } = renderApp('/events');
      await resultsLoaded();

      await user.type(searchBox(), 'echo{Enter}');
      expect(router.state.location.search).toBe('?q=echo');

      await act(() => router.navigate(-1));
      expect(searchBox()).toHaveValue('');
    });

    it('clearing the box removes the search', async () => {
      mockEventList(() => eventPage([concert]));
      const { user, router } = renderApp('/events?q=echo&category=CONCERT');
      await resultsLoaded();

      await user.clear(searchBox());
      await waitFor(
        () => {
          expect(router.state.location.search).toBe('?category=CONCERT');
        },
        { timeout: SEARCH_DEBOUNCE_MS + 1000 },
      );
    });
  });

  describe('pagination', () => {
    it('shows the pages and moves to the next one', async () => {
      const requests = mockEventList((query) =>
        eventPage(query.get('page') === '2' ? [meetup] : [concert], {
          page: Number(query.get('page')),
          total: 45,
        }),
      );
      const { user, router } = renderApp('/events?category=CONCERT');
      await screen.findByRole('link', { name: 'Midnight Echoes Live' });

      const pagination = within(screen.getByRole('navigation', { name: 'Pagination' }));
      expect(pagination.getByRole('link', { name: 'Page 1' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(pagination.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(pagination.getByRole('link', { name: 'Page 3' })).toHaveAttribute(
        'href',
        '/events?category=CONCERT&page=3',
      );

      await user.click(pagination.getByRole('link', { name: 'Next page' }));

      expect(router.state.location.search).toBe('?category=CONCERT&page=2');
      // Focus goes to the top of the results, not the end of the page.
      expect(screen.getByRole('heading', { name: 'Results' })).toHaveFocus();
      expect(await screen.findByRole('link', { name: 'Flaky Tests Clinic' })).toBeInTheDocument();
      expect(requests.at(-1)?.get('page')).toBe('2');
      expect(screen.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
        'href',
        '/events?category=CONCERT',
      );
    });

    it('disables "Next page" on the last page', async () => {
      mockEventList(() => eventPage([concert], { page: 3, total: 45 }));
      renderApp('/events?page=3');
      await resultsLoaded();

      expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(screen.getByRole('link', { name: 'Next page' })).not.toHaveAttribute('href');
      expect(screen.getByRole('status')).toHaveTextContent('Showing 41–41 of 45 events');
    });

    it('has no pagination when everything fits on one page', async () => {
      renderApp('/events');
      await resultsLoaded();

      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    });

    it('links to the last page from a page past the end', async () => {
      mockEventList((query) => eventPage([], { page: Number(query.get('page')), total: 45 }));
      renderApp('/events?page=9');

      expect(
        await screen.findByText('There’s no page 9: these results have 3 pages.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to the last page' })).toHaveAttribute(
        'href',
        '/events?page=3',
      );
    });
  });
});
