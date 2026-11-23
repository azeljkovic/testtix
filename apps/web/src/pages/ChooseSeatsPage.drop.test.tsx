import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { customer, logInAs } from '../testing/auth.js';
import { axe } from '../testing/axe.js';
import { dropDetail } from '../testing/catalogue-fixtures.js';
import { advanceClock, fakeClockAt, settleWithFakeClock } from '../testing/fake-clock.js';
import { holdOf, mockCreateHold } from '../testing/holds.js';
import { problemResponse } from '../testing/problems.js';
import { renderApp } from '../testing/render.js';
import { dropSeatMap, fixtureSeatId } from '../testing/seat-fixtures.js';
import {
  admissionTokenOf,
  FIXTURE_ADMISSION_TOKEN,
  FIXTURE_QUEUE_TOKEN,
  mockJoinQueue,
  mockQueueEntry,
  queueEntryOf,
} from '../testing/waiting-room.js';

const SEATS_PATH = '/events/new-year-drop/seats';
const QUEUE_PATH = '/events/new-year-drop/queue';
const B1 = fixtureSeatId(1, 'B', 1);

const NOW = Date.parse('2026-12-01T18:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('seat map of a ticket drop', () => {
  it('sends visitors who aren’t logged in to log in for the queue', async () => {
    const { router } = renderApp(SEATS_PATH);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?redirectTo=${encodeURIComponent(QUEUE_PATH)}`);
  });

  it('sends customers who aren’t let in yet to the waiting room', async () => {
    logInAs(customer);
    const joins = mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { position: 3 }));
    const { router } = renderApp(SEATS_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You’re in the queue' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(QUEUE_PATH);
    // One join: the waiting room picks up the entry the seat map page got.
    expect(joins).toHaveLength(1);
  });

  it('shows the map to a customer who was let in, with the time left in their turn', async () => {
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { status: 'ADMITTED', admissionExpiresAt: Date.now() + 300_000 }),
    );
    renderApp(SEATS_PATH);

    expect(await screen.findByRole('grid', { name: 'Stalls' })).toBeInTheDocument();
    const turn = within(screen.getByRole('region', { name: 'It’s your turn' }));
    expect(turn.getByRole('timer', { name: 'Your turn ends in' })).toHaveTextContent(
      /^(5:00|4:5\d)$/,
    );
    expect(turn.getByText(/Hold your tickets before your turn ends/)).toBeInTheDocument();

    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('sends the admission token with the hold', async () => {
    logInAs(customer);
    mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { status: 'ADMITTED' }));
    const holds = mockCreateHold(dropDetail.id, (body) => holdOf(dropSeatMap, body));
    const { user } = renderApp(SEATS_PATH);

    await user.click(
      await screen.findByRole('gridcell', { name: 'Stalls, row B, seat 1, $89.00, available' }),
    );
    await user.click(screen.getByRole('button', { name: 'Hold seats' }));

    expect(
      await screen.findByRole('region', { name: 'Your tickets are held' }),
    ).toBeInTheDocument();
    expect(holds).toHaveLength(1);
    expect(holds[0]?.body).toEqual({ seats: [B1], ga: [] });
    expect(holds.map(admissionTokenOf)).toEqual([FIXTURE_ADMISSION_TOKEN]);
  });

  it('goes to the waiting room when a hold says the admission has ended (403)', async () => {
    logInAs(customer);
    mockJoinQueue(dropDetail.id, queueEntryOf(dropDetail, { status: 'ADMITTED' }));
    mockCreateHold(dropDetail.id, () =>
      problemResponse({
        status: 403,
        code: 'QUEUE_REQUIRED',
        detail: 'Your admission has expired. Join the queue again.',
      }),
    );
    mockQueueEntry(FIXTURE_QUEUE_TOKEN, queueEntryOf(dropDetail, { status: 'EXPIRED' }));
    const { user, router } = renderApp(SEATS_PATH);

    await user.click(
      await screen.findByRole('gridcell', { name: 'Stalls, row B, seat 1, $89.00, available' }),
    );
    await user.click(screen.getByRole('button', { name: 'Hold seats' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your turn has ended' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(QUEUE_PATH);
  });

  it('shows the API’s answer when the map refuses an admission the queue still accepts', async () => {
    logInAs(customer);
    // A token the fixture map doesn't accept, while the queue says you're admitted.
    const wrongAdmission = {
      ...queueEntryOf(dropDetail, { status: 'ADMITTED' }),
      admission: { token: 'wrong-token', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    };
    mockJoinQueue(dropDetail.id, wrongAdmission);
    const checks = mockQueueEntry(FIXTURE_QUEUE_TOKEN, wrongAdmission);
    renderApp(SEATS_PATH);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t load the seat map' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Mock problem (403)');
    // The 403 made the page check the queue entry again before giving up.
    expect(checks).toHaveLength(1);
  });

  it('goes to the waiting room when the turn runs out by the browser clock', async () => {
    fakeClockAt(NOW);
    logInAs(customer);
    mockJoinQueue(
      dropDetail.id,
      queueEntryOf(dropDetail, { status: 'ADMITTED', admissionExpiresAt: NOW + 3000 }),
    );
    const checks = mockQueueEntry(
      FIXTURE_QUEUE_TOKEN,
      queueEntryOf(dropDetail, { status: 'EXPIRED' }),
    );
    const { router } = renderApp(SEATS_PATH);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('timer', { name: 'Your turn ends in' })).toHaveTextContent('0:03');
    });
    expect(screen.getByRole('grid', { name: 'Stalls' })).toBeInTheDocument();

    advanceClock(2000);
    expect(checks).toHaveLength(0);
    // At 0:00 the page checks the entry; the API says the admission has ended.
    advanceClock(1000);
    await settleWithFakeClock(() => {
      expect(router.state.location.pathname).toBe(QUEUE_PATH);
    });
    expect(checks.length).toBeGreaterThanOrEqual(1);
    await settleWithFakeClock(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your turn has ended');
    });
    expect(screen.getByRole('button', { name: 'Join the queue again' })).toBeInTheDocument();
  });
});
