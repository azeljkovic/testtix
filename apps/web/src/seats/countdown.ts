import { useEffect, useEffectEvent, useRef, useState } from 'react';

/** When the countdown warns that time is nearly up, in seconds left. */
export const LAST_MINUTE_SECONDS = 60;

/** Whole seconds from `nowMs` to `deadlineMs`, rounded up: it reaches 0 only when the time is up. */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** Seconds as a clock: "9:05", or "1:02:03" from an hour up. */
export function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toString().padStart(2, '0');
  return hours > 0
    ? `${hours.toString()}:${minutes.toString().padStart(2, '0')}:${secs}`
    : `${minutes.toString()}:${secs}`;
}

/** A duration in words, e.g. "10 minutes" or "1 minute 30 seconds". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const parts = [
    minutes > 0 ? `${minutes.toString()} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
    secs > 0 || minutes === 0 ? `${secs.toString()} ${secs === 1 ? 'second' : 'seconds'}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

interface CountdownCallbacks {
  /** Called once the deadline has passed (at once if it already had). */
  onExpire: () => void;
  /** Called when the time left drops to `LAST_MINUTE_SECONDS` or below. */
  onLastMinute?: () => void;
}

/**
 * Seconds left until `expiresAt` (an ISO date-time from the server). The time left is always
 * `expiresAt − Date.now()`, never counted down tick by tick, so it stays right when the tab is
 * throttled in the background and follows a faked browser clock (Playwright's `page.clock`,
 * Vitest's fake timers). One `setTimeout` at a time re-renders when the shown second changes.
 */
export function useCountdown(
  expiresAt: string,
  { onExpire, onLastMinute }: CountdownCallbacks,
): number {
  const deadline = Date.parse(expiresAt);
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(deadline, now);

  const expire = useEffectEvent(onExpire);
  useEffect(() => {
    // From the clock as it is now, not the render's `now`: the render may have come late.
    const msLeft = deadline - Date.now();
    if (msLeft <= 0) {
      expire();
      return;
    }
    // Wake when the rounded-up second changes: at the next whole second before the deadline.
    const timer = setTimeout(
      () => {
        setNow(Date.now());
      },
      msLeft % 1000 || 1000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [deadline, now]);

  const lastMinute = useEffectEvent(() => onLastMinute?.());
  const previous = useRef(left);
  useEffect(() => {
    if (previous.current > LAST_MINUTE_SECONDS && left <= LAST_MINUTE_SECONDS && left > 0) {
      lastMinute();
    }
    previous.current = left;
  }, [left]);

  return left;
}
