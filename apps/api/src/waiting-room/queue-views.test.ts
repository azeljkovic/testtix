import { describe, expect, it } from 'vitest';

import type { StoredEntry } from './queue-store.js';
import { MIN_QUEUE_RETRY_MS, type QueueEventSettings, toQueueEntry } from './queue-views.js';

const OPEN = new Date('2027-03-01T12:00:00.000Z');
const POLL_MS = 2000;

const event: QueueEventSettings = {
  salesOpenAt: OPEN,
  waitingRoomEnabled: true,
  admissionRatePerSec: 10,
};

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    eventId: 'event-1',
    userId: 'user-1',
    token: 'queue-token',
    admissionToken: 'admission-token',
    joinedAt: new Date(OPEN.getTime() - 60_000),
    rank: 0,
    admissionExpiresAt: null,
    waitingCount: 1,
    nextBatchAt: null,
    ...overrides,
  };
}

const at = (offsetMs: number) => new Date(OPEN.getTime() + offsetMs);

describe('toQueueEntry()', () => {
  it('shows no position before sales open, and polls no later than the opening', () => {
    expect(toQueueEntry(entry({ rank: 4, waitingCount: 9 }), event, at(-60_000), POLL_MS)).toEqual({
      token: 'queue-token',
      eventId: 'event-1',
      status: 'PRE_SALE',
      joinedAt: '2027-03-01T11:59:00.000Z',
      salesOpenAt: '2027-03-01T12:00:00.000Z',
      position: null,
      queueLength: 9,
      estimatedWaitMs: null,
      retryAfterMs: POLL_MS,
      admission: null,
    });
    expect(toQueueEntry(entry(), event, at(-700), POLL_MS).retryAfterMs).toBe(700);
    expect(toQueueEntry(entry(), event, at(-1), POLL_MS).retryAfterMs).toBe(MIN_QUEUE_RETRY_MS);
  });

  it('turns PRE_SALE into WAITING at the opening', () => {
    expect(toQueueEntry(entry(), event, OPEN, POLL_MS).status).toBe('WAITING');
  });

  it.each([
    // [rank, nextBatchAt offset, now offset, expected wait]
    [0, null, 0, 0], // next run lets the first batch in
    [9, null, 0, 0], // 10th: still the first batch
    [10, null, 0, 1000], // 11th: second batch
    [25, null, 5000, 2000], // 26th: third batch
    [0, 1000, 400, 600], // next batch due in 600 ms
    [10, 1000, 400, 1600],
    [0, 1000, 1500, 0], // overdue batch: the next run
  ])(
    'estimates the wait from the position and rate (rank %i, next batch %s, now %i)',
    (rank, nextBatch, now, expected) => {
      const view = toQueueEntry(
        entry({ rank, nextBatchAt: nextBatch === null ? null : at(nextBatch) }),
        event,
        at(now),
        POLL_MS,
      );
      expect(view).toMatchObject({ status: 'WAITING', position: rank + 1 });
      expect(view.estimatedWaitMs).toBe(expected);
    },
  );

  it('bounds retryAfterMs by the poll interval and the minimum', () => {
    expect(toQueueEntry(entry({ rank: 100 }), event, OPEN, POLL_MS).retryAfterMs).toBe(POLL_MS);
    expect(
      toQueueEntry(entry({ nextBatchAt: at(900) }), event, at(100), POLL_MS).retryAfterMs,
    ).toBe(800);
    expect(toQueueEntry(entry(), event, OPEN, POLL_MS).retryAfterMs).toBe(MIN_QUEUE_RETRY_MS);
  });

  it('expects everyone in at the next run once the waiting room is off', () => {
    const view = toQueueEntry(
      entry({ rank: 500 }),
      { ...event, waitingRoomEnabled: false },
      OPEN,
      POLL_MS,
    );
    expect(view).toMatchObject({ status: 'WAITING', position: 501, estimatedWaitMs: 0 });
  });

  it('shows the admission until it expires', () => {
    const admitted = entry({ rank: null, admissionExpiresAt: at(600_000), waitingCount: 0 });
    expect(toQueueEntry(admitted, event, at(599_999), POLL_MS)).toMatchObject({
      status: 'ADMITTED',
      position: null,
      estimatedWaitMs: null,
      retryAfterMs: null,
      admission: { token: 'admission-token', expiresAt: '2027-03-01T12:10:00.000Z' },
    });
    expect(toQueueEntry(admitted, event, at(600_000), POLL_MS)).toMatchObject({
      status: 'EXPIRED',
      retryAfterMs: null,
      admission: null,
    });
  });

  it('refuses an entry that is neither waiting nor admitted', () => {
    expect(() => toQueueEntry(entry({ rank: null }), event, OPEN, POLL_MS)).toThrow(
      /neither waiting nor admitted/,
    );
  });
});
