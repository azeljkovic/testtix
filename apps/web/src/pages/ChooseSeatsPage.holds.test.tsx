import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { customer, logInAs, logOut } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { concert, meetup } from '../testing/catalogue-fixtures.js';
import { advanceClock, settleWithFakeClock, fakeClockAt } from '../testing/fake-clock.js';
import {
  FIXTURE_HOLD_ID,
  holdOf,
  mockCreateHold,
  mockCurrentHold,
  mockReleaseHold,
  ticketsUnavailableResponse,
} from '../testing/holds.js';
import { MOCK_CSRF_TOKEN } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { concertSeatMap, fixtureSeatId, meetupSeatMap } from '../testing/seat-fixtures.js';
import { mockSeatMap, withSeatStatus } from '../testing/seats.js';

const CONCERT_SEATS = '/events/midnight-echoes-live/seats';
const MEETUP_TICKETS = '/events/flaky-tests-clinic/seats';
const LOFT = '01970000-0000-7000-8000-0000000000b3';
const B1 = fixtureSeatId(1, 'B', 1);
const B2 = fixtureSeatId(1, 'B', 2);

/** The fake clock's start in the countdown tests. */
const NOW = Date.parse('2026-11-22T18:00:00.000Z');

function stallsSeat(row: string, number: number) {
  return screen.getByRole('gridcell', {
    name: new RegExp(`^Stalls, row ${row}, seat ${number.toString()},`),
  });
}

function announcement() {
  return screen.getByRole('status').textContent.trim();
}

function listed(name: string) {
  return within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

function holdFigures() {
  const panel = within(screen.getByRole('region', { name: 'Your tickets are held' }));
  return panel.getAllByRole('definition').map((dd) => dd.textContent);
}

function holdButton(name = 'Hold seats') {
  return screen.getByRole('button', { name });
}

/** Waits until the page knows the session and the visitor's hold (if any). */
async function holdButtonReady(name = 'Hold seats') {
  expect(await screen.findByRole('button', { name })).toBeDisabled();
}

/** Presses the hold button once it is enabled (the session and current hold have loaded). */
async function pressHold(
  user: { click: (element: Element) => Promise<void> },
  name = 'Hold seats',
) {
  await waitFor(() => {
    expect(holdButton(name)).toBeEnabled();
  });
  await user.click(holdButton(name));
}

function timer() {
  return screen.getByRole('timer').textContent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('holding tickets', () => {
  it('asks visitors who aren’t logged in to log in first', async () => {
    renderApp(CONCERT_SEATS);
    const login = await screen.findByRole('link', { name: 'Log in to hold tickets' });

    expect(login).toHaveAttribute(
      'href',
      `/login?redirectTo=${encodeURIComponent('/events/midnight-echoes-live/seats')}`,
    );
    expect(screen.queryByRole('button', { name: 'Hold seats' })).not.toBeInTheDocument();
  });

  it('has no hold button while the event isn’t on sale', async () => {
    logInAs(customer);
    mockSeatMap(concert.id, () => ({ ...concertSeatMap, availability: 'SALES_ENDED' }));
    renderApp(CONCERT_SEATS);
    await screen.findByRole('grid', { name: 'Stalls' });

    expect(screen.queryByRole('button', { name: 'Hold seats' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in to hold tickets' })).not.toBeInTheDocument();
  });

  it('holds the chosen seats, then shows the hold with the map read-only', async () => {
    logInAs(customer);
    let map = concertSeatMap;
    const mapRequests = mockSeatMap(concert.id, () => map);
    const currentHoldRequests = mockCurrentHold(null);
    const requests = mockCreateHold(concert.id, (body) => {
      map = withSeatStatus(concertSeatMap, body.seats, 'HELD');
      return holdOf(concertSeatMap, body);
    });
    const { user } = renderApp(CONCERT_SEATS);
    await holdButtonReady();
    expect(currentHoldRequests).toEqual([concert.id]);

    await user.click(stallsSeat('B', 2));
    await user.click(stallsSeat('B', 1));
    await pressHold(user);

    const heading = await screen.findByRole('heading', { name: 'Your tickets are held' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ seats: [B1, B2], ga: [] });
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);

    expect(heading).toHaveFocus();
    expect(announcement()).toBe('2 tickets held for 10 minutes.');
    expect(listed('Held tickets')).toEqual([
      'Stalls, row B, seat 1$89.00',
      'Stalls, row B, seat 2$89.00',
    ]);
    expect(holdFigures()).toEqual(['2', '$178.00']);
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent(/^(10:00|9:5\d)$/);
    expect(screen.getByRole('link', { name: 'Check out' })).toHaveAttribute(
      'href',
      '/events/midnight-echoes-live/checkout',
    );
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();

    // The map is refetched: the held seats show as held, and nothing can be picked until release.
    await waitFor(() => {
      expect(stallsSeat('B', 1)).toHaveAccessibleName('Stalls, row B, seat 1, $89.00, held');
    });
    expect(mapRequests.requests).toBe(2);
    expect(screen.getByRole('grid', { name: 'Stalls' })).toHaveAttribute('aria-readonly', 'true');
  });

  it('holds GA places', async () => {
    logInAs(customer);
    const requests = mockCreateHold(meetup.id, (body) => holdOf(meetupSeatMap, body));
    const { user } = renderApp(MEETUP_TICKETS);
    await holdButtonReady('Hold tickets');

    await user.click(screen.getByRole('button', { name: 'Add a Loft ticket' }));
    await user.click(screen.getByRole('button', { name: 'Add a Loft ticket' }));
    await user.click(screen.getByRole('button', { name: 'Add a Loft ticket' }));
    await pressHold(user, 'Hold tickets');

    await screen.findByRole('heading', { name: 'Your tickets are held' });
    expect(requests[0]?.body).toEqual({ seats: [], ga: [{ sectionId: LOFT, quantity: 3 }] });
    expect(listed('Held tickets')).toEqual(['Loft, 3 tickets$35.00']);
    expect(holdFigures()).toEqual(['3', '$35.00']);
    expect(screen.getByRole('spinbutton', { name: 'Loft tickets' })).toBeDisabled();
  });

  it('says which seats were taken, refreshes the map and drops them from the selection', async () => {
    logInAs(customer);
    let map = concertSeatMap;
    const mapRequests = mockSeatMap(concert.id, () => map);
    mockCreateHold(concert.id, () => {
      // Someone else held B1 a moment earlier.
      map = withSeatStatus(concertSeatMap, [B1], 'HELD');
      return ticketsUnavailableResponse({ unavailableSeatIds: [B1] });
    });
    const { user } = renderApp(CONCERT_SEATS);
    await holdButtonReady();
    await user.click(stallsSeat('B', 1));
    await user.click(stallsSeat('B', 2));
    await pressHold(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Someone else got some of these tickets first, so nothing was held.',
    );
    expect(listed('Tickets no longer available')).toEqual(['Stalls, row B, seat 1']);

    await waitFor(() => {
      expect(stallsSeat('B', 1)).toHaveAccessibleName('Stalls, row B, seat 1, $89.00, held');
    });
    expect(mapRequests.requests).toBe(2);
    expect(listed('Chosen tickets')).toEqual([
      'Stalls, row B, seat 2$89.00Remove Stalls, row B, seat 2',
    ]);
    expect(screen.queryByRole('region', { name: 'Your tickets are held' })).not.toBeInTheDocument();
    expect(holdButton()).toBeEnabled();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('says how many GA places are left when there aren’t enough', async () => {
    logInAs(customer);
    let map = meetupSeatMap;
    mockSeatMap(meetup.id, () => map);
    mockCreateHold(meetup.id, () => {
      map = {
        ...meetupSeatMap,
        sections: meetupSeatMap.sections.map((section) =>
          section.type === 'GA'
            ? { ...section, available: 1, prices: [{ priceCents: 1000, available: 1 }] }
            : section,
        ),
      };
      return ticketsUnavailableResponse({
        gaShortfalls: [{ sectionId: LOFT, requested: 3, available: 1 }],
      });
    });
    const { user } = renderApp(MEETUP_TICKETS);
    await holdButtonReady('Hold tickets');
    const stepper = screen.getByRole('spinbutton', { name: 'Loft tickets' });
    await user.click(stepper);
    await user.keyboard('{End}');
    await pressHold(user, 'Hold tickets');

    await screen.findByRole('alert');
    expect(listed('Tickets no longer available')).toEqual(['Loft: 1 left (you asked for 3)']);
    await waitFor(() => {
      expect(stepper).toHaveValue('1');
    });
  });

  it('shows other failures, and refreshes the map when sales have closed', async () => {
    logInAs(customer);
    let map = concertSeatMap;
    mockSeatMap(concert.id, () => map);
    mockCreateHold(concert.id, () => {
      map = { ...concertSeatMap, availability: 'SALES_ENDED' };
      return problemResponse({
        status: 409,
        code: 'EVENT_NOT_ON_SALE',
        detail: 'Tickets for this event are no longer on sale.',
      });
    });
    const { user } = renderApp(CONCERT_SEATS);
    await holdButtonReady();
    await user.click(stallsSeat('B', 1));
    await pressHold(user);

    await waitFor(() => {
      expect(screen.getByRole('grid', { name: 'Stalls' })).toHaveAttribute('aria-readonly', 'true');
    });
    expect(
      screen.getByText(/This event has started, so tickets are no longer sold\./),
    ).toBeInTheDocument();
    // Not on sale any more: no hold button (and so no stale error next to it).
    expect(screen.queryByRole('button', { name: 'Hold seats' })).not.toBeInTheDocument();
  });

  it('asks to log in again when the session has ended', async () => {
    logInAs(customer);
    mockCreateHold(concert.id, () => {
      // The API now answers 401 for the session check too.
      logOut();
      return problemResponse({ status: 401 });
    });
    const { user } = renderApp(CONCERT_SEATS);
    await holdButtonReady();
    await user.click(stallsSeat('B', 1));
    await pressHold(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session has ended. Log in again to hold tickets.',
    );
    expect(await screen.findByRole('link', { name: 'Log in to hold tickets' })).toBeInTheDocument();
  });

  it('releases the hold', async () => {
    logInAs(customer);
    const hold = holdOf(concertSeatMap, { seats: [B1] });
    mockCurrentHold(hold);
    const mapRequests = mockSeatMap(concert.id, () => concertSeatMap);
    const releases = mockReleaseHold();
    const { user } = renderApp(CONCERT_SEATS);
    await screen.findByRole('heading', { name: 'Your tickets are held' });

    await user.click(screen.getByRole('button', { name: 'Release hold' }));

    const heading = await screen.findByRole('heading', { name: 'Your selection' });
    expect(releases.map(({ url }) => url.pathname)).toEqual([`/api/holds/${FIXTURE_HOLD_ID}`]);
    expect(releases[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    expect(heading).toHaveFocus();
    expect(announcement()).toBe('Hold released. The tickets are available to others again.');
    await waitFor(() => {
      expect(mapRequests.requests).toBe(2);
    });
    expect(screen.getByRole('grid', { name: 'Stalls' })).toHaveAttribute(
      'aria-multiselectable',
      'true',
    );
  });

  it('keeps the hold when releasing it fails', async () => {
    logInAs(customer);
    mockCurrentHold(holdOf(concertSeatMap, { seats: [B1] }));
    mockReleaseHold(() => problemResponse({ status: 500 }));
    const { user } = renderApp(CONCERT_SEATS);
    await screen.findByRole('heading', { name: 'Your tickets are held' });

    await user.click(screen.getByRole('button', { name: 'Release hold' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Please try again.',
    );
    expect(screen.getByRole('heading', { name: 'Your tickets are held' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('hold countdown', () => {
  /** Fakes the clock at `NOW` and renders the concert's seat map with a hold made at `NOW`. */
  async function renderWithHold() {
    fakeClockAt(NOW);
    logInAs(customer);
    let map = withSeatStatus(concertSeatMap, [B1, B2], 'HELD');
    const mapRequests = mockSeatMap(concert.id, () => map);
    const hold = holdOf(concertSeatMap, { seats: [B1, B2] }, { createdAt: NOW });
    mockCurrentHold(hold);
    const rendered = renderApp(CONCERT_SEATS);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('timer')).toBeInTheDocument();
    });
    // Back to the moment the hold was made. Pending timers keep their time left.
    act(() => {
      vi.setSystemTime(NOW);
    });
    const releaseSeats = () => {
      map = concertSeatMap;
    };
    return { ...rendered, mapRequests, releaseSeats };
  }

  it('counts down from the hold’s expiry by the browser clock', async () => {
    await renderWithHold();
    expect(timer()).toBe('10:00');

    advanceClock(999);
    expect(timer()).toBe('10:00');
    advanceClock(1);
    expect(timer()).toBe('9:59');
    advanceClock(4 * 60_000);
    expect(timer()).toBe('5:59');

    // A throttled background tab: minutes pass before the next timer fires. That tick shows the time
    // left by the clock, not one second less than before.
    act(() => {
      vi.setSystemTime(NOW + 8 * 60_000 + 500);
    });
    expect(timer()).toBe('5:59');
    advanceClock(1000);
    expect(timer()).toBe('1:59');
    advanceClock(500);
    expect(timer()).toBe('1:58');
  });

  it('warns once when less than a minute is left', async () => {
    await renderWithHold();
    advanceClock(9 * 60_000 - 1);
    expect(timer()).toBe('1:01');
    expect(announcement()).toBe('');
    expect(
      screen.getByText('Nobody else can take these tickets until the timer runs out.'),
    ).toBeInTheDocument();

    advanceClock(1);
    expect(timer()).toBe('1:00');
    expect(announcement()).toBe('Less than a minute left on your hold.');
    expect(
      screen.getByText(
        'Less than a minute left. When the timer runs out, the tickets are released.',
      ),
    ).toBeInTheDocument();
  });

  it('on expiry shows a banner, clears the hold and refreshes the map', async () => {
    const { mapRequests, releaseSeats } = await renderWithHold();
    expect(mapRequests.requests).toBe(1);
    // The focus is in the hold panel, which is about to disappear.
    screen.getByRole('button', { name: 'Release hold' }).focus();
    releaseSeats();

    advanceClock(10 * 60_000 - 1);
    expect(timer()).toBe('0:01');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    advanceClock(1);
    const banner = within(screen.getByRole('alert'));
    expect(banner.getByText('Your hold expired')).toBeInTheDocument();
    expect(
      banner.getByText(/^The tickets were released, and the map now shows what’s available\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your selection' })).toHaveFocus();
    expect(screen.getByText('No tickets chosen yet.')).toBeInTheDocument();

    await settleWithFakeClock(() => {
      expect(stallsSeat('B', 1)).toHaveAccessibleName('Stalls, row B, seat 1, $89.00, available');
    });
    expect(mapRequests.requests).toBe(2);

    // The seats can be chosen and held again.
    fireEvent.click(stallsSeat('B', 1));
    expect(holdButton()).toBeEnabled();
  });

  it('expires at once a hold that ran out before the page loaded', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockCurrentHold(
      holdOf(concertSeatMap, { seats: [B1] }, { createdAt: NOW - 600_000, durationSec: 600 }),
    );
    renderApp(CONCERT_SEATS);

    await settleWithFakeClock(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Your hold expired');
    });
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    await renderWithHold();
    vi.useRealTimers();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
