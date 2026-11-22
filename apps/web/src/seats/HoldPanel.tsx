import { formatPrice } from '@testtix/shared';
import { useEffect, useRef } from 'react';

import type { Hold, HoldItem } from '../api/holds.js';
import { formatTicketPrice, ticketCount } from '../catalogue/format.js';
import { FormAlert } from '../forms/FormAlert.js';
import { formatCountdown, LAST_MINUTE_SECONDS, useCountdown } from './countdown.js';
import { seatPlace } from './selection.js';

interface HoldPanelProps {
  hold: Hold;
  /** Moves the focus to the heading when it appears (after the visitor held the tickets). */
  focusOnMount: boolean;
  onExpire: () => void;
  onLastMinute: () => void;
  onRelease: () => void;
  isReleasing: boolean;
  /** Why the last release failed, if it did. */
  releaseError: string | undefined;
}

interface HeldLine {
  key: string;
  label: string;
  cents: number;
}

/** One line per seat, and one per GA section with its quantity, in the hold's (venue) order. */
function heldLines(items: readonly HoldItem[]): HeldLine[] {
  const lines: HeldLine[] = [];
  const gaLines = new Map<string, { line: HeldLine; quantity: number }>();
  for (const { seat, section, priceCents } of items) {
    if (seat !== null) {
      lines.push({
        key: seat.id,
        label: seatPlace(section.name, seat.row, seat.number),
        cents: priceCents,
      });
      continue;
    }
    const ga = gaLines.get(section.id) ?? {
      line: { key: section.id, label: '', cents: 0 },
      quantity: 0,
    };
    if (ga.quantity === 0) {
      gaLines.set(section.id, ga);
      lines.push(ga.line);
    }
    ga.quantity++;
    ga.line.cents += priceCents;
    ga.line.label = `${section.name}, ${ticketCount(ga.quantity)}`;
  }
  return lines;
}

/**
 * The visitor's active hold: what is held, the total, a countdown to `expiresAt` and a release
 * button. The countdown follows the browser clock (see `useCountdown()`); render it with
 * `key={hold.id}` so a new hold starts a fresh one.
 */
export function HoldPanel({
  hold,
  focusOnMount,
  onExpire,
  onLastMinute,
  onRelease,
  isReleasing,
  releaseError,
}: HoldPanelProps) {
  const left = useCountdown(hold.expiresAt, { onExpire, onLastMinute });
  const lines = heldLines(hold.items);
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
      <p
        className={`flex items-baseline justify-between gap-3 rounded-md px-3 py-2 ${
          lastMinute ? 'bg-red-100 text-red-900' : 'bg-white text-slate-900'
        }`}
      >
        <span>Time left</span>
        <span role="timer" className="text-2xl font-bold tabular-nums">
          {formatCountdown(left)}
        </span>
      </p>
      <p className="text-sm">
        {lastMinute
          ? 'Less than a minute left. When the timer runs out, the tickets are released.'
          : 'Nobody else can take these tickets until the timer runs out.'}
      </p>
      <ul aria-label="Held tickets" className="flex flex-col divide-y divide-emerald-200">
        {lines.map((line) => (
          <li key={line.key} className="flex items-baseline gap-x-3 py-2">
            <span className="grow">{line.label}</span>
            <span className="tabular-nums">{formatTicketPrice(line.cents)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-emerald-300 pt-3">
        <dt>Tickets</dt>
        <dd className="text-right tabular-nums">{hold.items.length.toString()}</dd>
        <dt className="font-semibold text-slate-900">Total</dt>
        <dd className="text-right font-semibold text-slate-900 tabular-nums">
          {formatPrice(hold.totalCents)}
        </dd>
      </dl>
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
