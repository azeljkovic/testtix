import { useId } from 'react';

import { useCountdown } from '../seats/countdown.js';
import { formatLongCountdown } from './format.js';

interface SalesCountdownProps {
  /** ISO date-time. */
  salesOpenAt: string;
  /** Called once sales open by the browser clock (at once if they already have). */
  onOpen: () => void;
}

/**
 * A `timer` named "Sales open in", counting down to `salesOpenAt` by the browser clock (the same
 * rules as the hold countdown, `useCountdown()`). Nothing once sales have opened.
 */
export function SalesCountdown({ salesOpenAt, onOpen }: SalesCountdownProps) {
  const left = useCountdown(salesOpenAt, { onExpire: onOpen });
  const labelId = useId();
  if (left === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md bg-white px-3 py-2 text-slate-900">
      <span id={labelId}>Sales open in</span>
      <span role="timer" aria-labelledby={labelId} className="text-2xl font-bold tabular-nums">
        {formatLongCountdown(left)}
      </span>
    </p>
  );
}
