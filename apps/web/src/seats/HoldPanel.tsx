import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import type { Hold } from '../api/holds.js';
import { FormAlert } from '../forms/FormAlert.js';
import { LAST_MINUTE_SECONDS, useCountdown } from './countdown.js';
import { HeldTickets, TimeLeft } from './HeldTickets.js';

interface HoldPanelProps {
  hold: Hold;
  /** The checkout page for the hold. */
  checkoutHref: string;
  /** Moves the focus to the heading when it appears (after the visitor held the tickets). */
  focusOnMount: boolean;
  onExpire: () => void;
  onLastMinute: () => void;
  onRelease: () => void;
  isReleasing: boolean;
  /** Why the last release failed, if it did. */
  releaseError: string | undefined;
}

/**
 * The visitor's active hold: what is held, the total, a countdown to `expiresAt`, a link to the
 * checkout and a release button. The countdown follows the browser clock (see `useCountdown()`);
 * render it with `key={hold.id}` so a new hold starts a fresh one.
 */
export function HoldPanel({
  hold,
  checkoutHref,
  focusOnMount,
  onExpire,
  onLastMinute,
  onRelease,
  isReleasing,
  releaseError,
}: HoldPanelProps) {
  const left = useCountdown(hold.expiresAt, { onExpire, onLastMinute });
  const lastMinute = left <= LAST_MINUTE_SECONDS;

  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(focusOnMount);
  useEffect(() => {
    if (shouldFocus.current) headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="hold-heading"
      className="flex flex-col gap-4 rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-slate-700"
    >
      <h2
        ref={headingRef}
        id="hold-heading"
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus:outline-none"
      >
        Your tickets are held
      </h2>
      <TimeLeft seconds={left} />
      <p className="text-sm">
        {lastMinute
          ? 'Less than a minute left. When the timer runs out, the tickets are released.'
          : 'Nobody else can take these tickets until the timer runs out.'}
      </p>
      <HeldTickets items={hold.items} totalCents={hold.totalCents} label="Held tickets" />
      <Link
        to={checkoutHref}
        className="rounded-md bg-indigo-700 px-5 py-2.5 text-center font-semibold text-white hover:bg-indigo-800"
      >
        Check out
      </Link>
      <p className="text-sm">To change your tickets, release this hold and choose again.</p>
      {releaseError !== undefined && <FormAlert>{releaseError}</FormAlert>}
      <button
        type="button"
        onClick={() => {
          if (!isReleasing) onRelease();
        }}
        aria-disabled={isReleasing || undefined}
        className="self-start rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        {isReleasing ? 'Releasing…' : 'Release hold'}
      </button>
    </section>
  );
}
