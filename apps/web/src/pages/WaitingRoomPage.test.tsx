import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { concertDetail, dropDetail } from '../testing/catalogue-fixtures.js';
import { advanceClock, fakeClockAt, settleWithFakeClock } from '../testing/fake-clock.js';
import { holdOf, mockCurrentHold } from '../testing/holds.js';
import { MOCK_CSRF_TOKEN } from '../testing/msw-server.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { dropSeatMap, fixtureSeatId } from '../testing/seat-fixtures.js';
import { mockSeatMap } from '../testing/seats.js';
import {
  FIXTURE_QUEUE_TOKEN,
  mockJoinQueue,
  mockQueueEntry,
  queueEntryOf,
} from '../testing/waiting-room.js';

const QUEUE_PATH = '/events/new-year-drop/queue';
const SEATS_PATH = '/events/new-year-drop/seats';

/** The fake clock's start in the polling tests. */
const NOW = Date.parse('2026-12-01T18:00:00.000Z');

function heading() {
  return screen.getByRole('heading', { level: 1 });
}

/** The live region that holds the status heading and message. */
function statusRegion() {
  const region = heading().closest('[role="status"]');
  if (!(region instanceof HTMLElement)) {
    throw new Error('The status heading isn’t in a live region');
  }
  return region;
}

/** The "Your place", "People in the queue" and "Estimated wait" values. */
function queueDetails() {
  return screen.getAllByRole('definition').map((dd) => dd.textContent);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('waiting room page', () => {
  it('sends visitors who aren’t logged in to log in, then back to the queue', async () => {
    const { router } = renderApp(QUEUE_PATH);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?redirectTo=${encodeURIComponent(QUEUE_PATH)}`);
  });

  it('joins the queue before sales open and counts down to the opening', async () => {
    logInAs(customer);
    const salesOpenAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const requests = mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { status: 'PRE_SALE', salesOpenAt }),
    );
    renderApp(QUEUE_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You’re in the waiting room' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('You’re in the waiting room · TestTix');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.csrf).toBe(MOCK_CSRF_TOKEN);
    expect(statusRegion()).toHaveTextContent(
      /^You’re in the waiting roomSales open .+\. Everyone who joins before then gets a place in a random order/,
    );
    expect(screen.getByRole('timer', { name: 'Sales open in' })).toHaveTextContent(
      /^(2:00:00|1:59:5\d)$/,
    );
    expect(screen.getByText(/Keep this page open/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ Back to the event' })).toHaveAttribute(
      'href',
      '/events/new-year-drop',
    );

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('shows your place in the queue and the estimated wait', async () => {
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { position: 12, queueLength: 340, estimatedWaitMs: 95_000 }),
    );
    renderApp(QUEUE_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You’re in the queue' }),
    ).toBeInTheDocument();
    expect(statusRegion()).toHaveTextContent('You’re number 12 in the queue.');
    expect(queueDetails()).toEqual(['12', '340', 'About 2 minutes']);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('says who is next', async () => {
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { position: 1, queueLength: 1, estimatedWaitMs: 0 }),
    );
    renderApp(QUEUE_PATH);

    await screen.findByRole('heading', { level: 1, name: 'You’re in the queue' });
    expect(statusRegion()).toHaveTextContent('You’re next in the queue.');
    expect(queueDetails()).toEqual(['1', '1', 'Any moment now']);
  });

  it('goes to the seat map once you’re let in, with the admission token', async () => {
    logInAs(customer);
    mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { status: 'ADMITTED' }));
    const { router } = renderApp(QUEUE_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose seats' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(SEATS_PATH);
    // The fixture map only answers with the admission token.
    expect(screen.getByRole('grid', { name: 'Stalls' })).toBeInTheDocument();
    const turn = within(screen.getByRole('region', { name: 'It’s your turn' }));
    expect(turn.getByRole('timer', { name: 'Your turn ends in' })).toHaveTextContent(
      /^(10:00|9:5\d)$/,
    );
  });

  it('goes straight to the seat map of an event without a waiting room', async () => {
    logInAs(customer);
    const { router } = renderApp(`/events/${concertDetail.slug}/queue`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose seats' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/events/${concertDetail.slug}/seats`);
  });

  it('says when the event doesn’t exist', async () => {
    logInAs(customer);
    renderApp('/events/no-such-event/queue');

    expect(await screen.findByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
  });

  it('says when sales have ended (409 event-not-on-sale)', async () => {
    logInAs(customer);
    mockJoinQueue(dropDetail.id, problemResponse({ status: 409, code: 'EVENT_NOT_ON_SALE' }));
    renderApp(QUEUE_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sales have ended' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the event' })).toHaveAttribute(
      'href',
      '/events/new-year-drop',
    );
  });

  it('offers a retry when joining fails', async () => {
    logInAs(customer);
    const requests = mockJoinQueue(
      dropDetail.id,
      problemResponse({ status: 503 }),
      queueEntryOf(dropDetail),
    );
    const { user } = renderApp(QUEUE_PATH);

    const alert = await screen.findByRole('alert');
    expect(heading()).toHaveTextContent('We couldn’t get you into the queue');
    expect(alert).toHaveTextContent('Something went wrong on our side. Please try again.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You’re in the queue' }),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('shows an ended turn, the tickets still held, and queues you again on request', async () => {
    logInAs(customer);
    // Let in, but the admission has ended by the time the seat map is asked for.
    const joins = mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { status: 'ADMITTED' }),
      queueEntryOf(dropDetail, { token: 'second-queue-token', position: 40, queueLength: 40 }),
    );
    mockSeatMap(dropDetail.id, () =>
      problemResponse({
        status: 403,
        code: 'QUEUE_REQUIRED',
        detail: 'Your admission has expired. Join the queue again.',
      }),
    );
    mockQueueEntry(FIXTURE_QUEUE_TOKEN, queueEntryOf(dropDetail, { status: 'EXPIRED' }));
    const hold = holdOf(dropSeatMap, {
      seats: [fixtureSeatId(1, 'B', 1), fixtureSeatId(1, 'B', 2)],
    });
    mockCurrentHold(hold);
    const { user, router } = renderApp(SEATS_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your turn has ended' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(QUEUE_PATH);
    expect(statusRegion()).toHaveTextContent(/Your time to choose tickets ran out/);
    expect(await screen.findByText(/You still have 2 tickets on hold/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check out' })).toHaveAttribute(
      'href',
      '/events/new-year-drop/checkout',
    );
    expect(await axe(document.body)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Join the queue again' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You’re in the queue' }),
    ).toHaveFocus();
    expect(statusRegion()).toHaveTextContent('You’re number 40 in the queue.');
    expect(joins).toHaveLength(2);
    expect(joins[1]?.csrf).toBe(MOCK_CSRF_TOKEN);
  });

  it('shows why queueing again failed', async () => {
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { status: 'ADMITTED' }),
      problemResponse({
        status: 409,
        code: 'EVENT_NOT_ON_SALE',
        detail: 'The event has started: sales have ended.',
      }),
    );
    mockSeatMap(dropDetail.id, () => problemResponse({ status: 403, code: 'QUEUE_REQUIRED' }));
    mockQueueEntry(FIXTURE_QUEUE_TOKEN, queueEntryOf(dropDetail, { status: 'EXPIRED' }));
    const { user } = renderApp(SEATS_PATH);

    await user.click(await screen.findByRole('button', { name: 'Join the queue again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The event has started: sales have ended.',
    );
    expect(heading()).toHaveTextContent('Your turn has ended');
  });
});

describe('waiting room polling', () => {
  it('polls after each response’s retryAfterMs, announces your place and lets you in', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { position: 5, retryAfterMs: 2000 }));
    const polls = mockQueueEntry(
      FIXTURE_QUEUE_TOKEN,
      queueEntryOf(dropDetail, { position: 2, retryAfterMs: 1000 }),
      queueEntryOf(dropDetail, { status: 'ADMITTED' }),
    );
    const { router } = renderApp(QUEUE_PATH);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 5 in the queue.');
    });
    expect(polls).toHaveLength(0);

    advanceClock(1900);
    expect(polls).toHaveLength(0);
    advanceClock(200);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 2 in the queue.');
    });
    expect(polls).toHaveLength(1);
    expect(queueDetails()[0]).toBe('2');

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(router.state.location.pathname).toBe(SEATS_PATH);
    });
    await settleWithFakeClock(() => {
      expect(screen.getByRole('grid', { name: 'Stalls' })).toBeInTheDocument();
    });
    // The seat map page checks the entry once more when it opens.
    expect(polls).toHaveLength(3);

    // Admitted is final: no more polling.
    advanceClock(10_000);
    expect(polls).toHaveLength(3);
  });

  it('checks again as soon as sales open by the browser clock', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, {
        status: 'PRE_SALE',
        salesOpenAt: new Date(NOW + 3000).toISOString(),
        // Longer than the time left, so the countdown triggers the check.
        retryAfterMs: 60_000,
      }),
    );
    const polls = mockQueueEntry(FIXTURE_QUEUE_TOKEN, queueEntryOf(dropDetail, { position: 7 }));
    renderApp(QUEUE_PATH);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('timer', { name: 'Sales open in' })).toHaveTextContent('0:03');
    });

    advanceClock(2000);
    expect(screen.getByRole('timer', { name: 'Sales open in' })).toHaveTextContent('0:01');
    expect(polls).toHaveLength(0);
    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(heading()).toHaveTextContent('You’re in the queue');
    });
    expect(polls).toHaveLength(1);
    expect(statusRegion()).toHaveTextContent('You’re number 7 in the queue.');
  });

  it('keeps your place on screen and keeps polling when a poll fails', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { position: 5, retryAfterMs: 1000 }));
    const polls = mockQueueEntry(
      FIXTURE_QUEUE_TOKEN,
      problemResponse({ status: 503 }),
      queueEntryOf(dropDetail, { position: 3, retryAfterMs: 1000 }),
    );
    renderApp(QUEUE_PATH);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 5 in the queue.');
    });

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(screen.getByText(/couldn’t check for updates/)).toBeInTheDocument();
    });
    expect(statusRegion()).toHaveTextContent('You’re number 5 in the queue.');

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 3 in the queue.');
    });
    expect(polls).toHaveLength(2);
    expect(screen.queryByText(/couldn’t check for updates/)).not.toBeInTheDocument();
  });

  it('joins again when the queue token is no longer valid (404)', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    const joins = mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { position: 5, retryAfterMs: 1000 }),
      queueEntryOf(dropDetail, { token: 'new-queue-token', position: 9 }),
    );
    mockQueueEntry(FIXTURE_QUEUE_TOKEN, problemResponse({ status: 404 }));
    renderApp(QUEUE_PATH);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 5 in the queue.');
    });

    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(statusRegion()).toHaveTextContent('You’re number 9 in the queue.');
    });
    expect(joins).toHaveLength(2);
  });
});
