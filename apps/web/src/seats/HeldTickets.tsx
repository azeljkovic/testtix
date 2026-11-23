import { formatPrice } from '@testtix/shared';
import { useId } from 'react';

import type { HoldItem } from '../api/holds.js';
import { formatTicketPrice, ticketCount } from '../catalogue/format.js';
import { formatCountdown, LAST_MINUTE_SECONDS } from './countdown.js';
import { seatPlace } from './selection.js';

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

interface HeldTicketsProps {
  /** A hold's or an order's items (an order item is a hold item with its ticket). */
  items: readonly HoldItem[];
  totalCents: number;
  /** The list's accessible name. */
  label: string;
  /** Tailwind classes for the dividers, to match the surrounding panel. */
  tone?: 'emerald' | 'slate';
}

/** The tickets of a hold or order, one line per seat or GA section, with the count and total. */
export function HeldTickets({ items, totalCents, label, tone = 'emerald' }: HeldTicketsProps) {
  const lines = heldLines(items);
  const [divide, border] =
    tone === 'emerald'
      ? ['divide-emerald-200', 'border-emerald-300']
      : ['divide-slate-200', 'border-slate-300'];
  return (
    <>
      <ul aria-label={label} className={`flex flex-col divide-y ${divide}`}>
        {lines.map((line) => (
          <li key={line.key} className="flex items-baseline gap-x-3 py-2">
            <span className="grow">{line.label}</span>
            <span className="tabular-nums">{formatTicketPrice(line.cents)}</span>
          </li>
        ))}
      </ul>
      <dl className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t ${border} pt-3`}>
        <dt>Tickets</dt>
        <dd className="text-right tabular-nums">{items.length.toString()}</dd>
        <dt className="font-semibold text-slate-900">Total</dt>
        <dd className="text-right font-semibold text-slate-900 tabular-nums">
          {formatPrice(totalCents)}
        </dd>
      </dl>
    </>
  );
}

/** Seconds left (from `useCountdown()`) as a clock: a `timer` named `label`, red in the last minute. */
export function TimeLeft({ seconds, label = 'Time left' }: { seconds: number; label?: string }) {
  const labelId = useId();
  const lastMinute = seconds <= LAST_MINUTE_SECONDS;
  return (
    <p
      className={`flex items-baseline justify-between gap-3 rounded-md px-3 py-2 ${
        lastMinute ? 'bg-red-100 text-red-900' : 'bg-white text-slate-900'
      }`}
    >
      <span id={labelId}>{label}</span>
      <span role="timer" aria-labelledby={labelId} className="text-2xl font-bold tabular-nums">
        {formatCountdown(seconds)}
      </span>
    </p>
  );
}
