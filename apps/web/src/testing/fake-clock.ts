import { act } from '@testing-library/react';
import { vi } from 'vitest';

// Captured before any test fakes it.
const realSetTimeout = globalThis.setTimeout;

/**
 * Fakes the browser clock at `now`: `Date` and the timers (`setTimeout`, `setInterval` and their
 * `clear…`, which React Query's `refetchInterval` uses), as Playwright's `page.clock` does. Undo with `vi.useRealTimers()` (in `afterEach`). While it is on, wait with
 * `settleWithFakeClock()` and type with `fireEvent`: Testing Library's `waitFor` / `findBy…` and
 * user-event wait on a `setTimeout` that a faked one never fires.
 */
export function fakeClockAt(now: number): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    now,
  });
}

/**
 * Waits for `check` to pass under `fakeClockAt()`: it gives requests real time to finish and runs
 * due fake timers (React Query's notifications). The fetch stack only finishes once the fake clock
 * has moved, so each round moves it 1 ms; a test that counts time puts it back afterwards with
 * `act(() => { vi.setSystemTime(…) })` (pending timers keep their time left).
 */
export async function settleWithFakeClock(check: () => void): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      check();
      return;
    } catch (error) {
      if (attempt > 200) throw error;
      await act(async () => {
        await new Promise((resolve) => realSetTimeout(resolve, 5));
        await vi.advanceTimersByTimeAsync(1);
      });
    }
  }
}

/**
 * Moves the fake clock on by `ms`, at most a second per `act()`, so a once-a-second timer re-renders
 * and schedules its next tick before the clock moves past it.
 */
export function advanceClock(ms: number): void {
  for (let left = ms; left > 0; left -= 1000) {
    act(() => {
      vi.advanceTimersByTime(Math.min(left, 1000));
    });
  }
}
