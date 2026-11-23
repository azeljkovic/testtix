import { LOCALE } from '@testtix/shared';

import { formatCountdown, formatDuration } from '../seats/countdown.js';

const DAY_SECONDS = 86_400;

/**
 * The queue's estimated wait in words: "Any moment now", "About 45 seconds" (to the second under a
 * minute), then rounded to whole minutes ("About 2 minutes", "About 90 minutes").
 */
export function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 0) return 'Any moment now';
  if (seconds < 60) return `About ${formatDuration(seconds)}`;
  return `About ${formatDuration(Math.round(seconds / 60) * 60)}`;
}

/** "You’re number 12 in the queue." / "You’re next in the queue." */
export function positionSentence(position: number): string {
  return position === 1
    ? 'You’re next in the queue.'
    : `You’re number ${position.toLocaleString(LOCALE)} in the queue.`;
}

/** Seconds as a clock, with whole days in words in front: "9:05", "1:02:03", "2 days, 3:04:05". */
export function formatLongCountdown(seconds: number): string {
  const days = Math.floor(seconds / DAY_SECONDS);
  const rest = formatCountdown(seconds % DAY_SECONDS);
  if (days === 0) return rest;
  return `${days.toString()} ${days === 1 ? 'day' : 'days'}, ${rest}`;
}
