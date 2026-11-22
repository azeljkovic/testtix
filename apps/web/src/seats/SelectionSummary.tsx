import { formatPrice } from '@testtix/shared';
import { type ReactNode, useEffect, useRef } from 'react';

import { formatTicketPrice, ticketCount } from '../catalogue/format.js';
import { type SelectedSeat, type SelectionSummary as Summary, seatPlace } from './selection.js';

interface SelectionSummaryProps {
  summary: Summary;
  maxTickets: number;
  onRemoveSeat: (seat: SelectedSeat) => void;
  onRemoveGa: (sectionId: string) => void;
  onClear: () => void;
  /** Moves the focus to the heading when it appears (e.g. after a hold was released). */
  focusOnMount?: boolean;
  /** Actions below the summary (the hold button). */
  children?: ReactNode;
}

const REMOVE_CLASS = 'text-sm font-medium text-indigo-700 underline underline-offset-4';

/** The picked seats and GA places with their prices, the ticket count and the running total. */
export function SelectionSummary({
  summary,
  maxTickets,
  onRemoveSeat,
  onRemoveGa,
  onClear,
  focusOnMount = false,
  children,
}: SelectionSummaryProps) {
  const { seats, ga, count, totalCents } = summary;
  // A remove button disappears with its line, so the focus moves to the heading instead of the page.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(focusOnMount);
  useEffect(() => {
    if (shouldFocus.current) headingRef.current?.focus();
  }, []);
  const andRefocus = (action: () => void) => () => {
    action();
    headingRef.current?.focus();
  };

  return (
    <section
      aria-labelledby="selection-heading"
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 p-5 text-slate-700"
    >
      <h2
        ref={headingRef}
        id="selection-heading"
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus:outline-none"
      >
        Your selection
      </h2>
      {count === 0 ? (
        <p>No tickets chosen yet.</p>
      ) : (
        <ul aria-label="Chosen tickets" className="flex flex-col divide-y divide-slate-200">
          {seats.map((selected) => {
            const place = seatPlace(
              selected.section.name,
              selected.row.label,
              selected.seat.number,
            );
            return (
              <li key={selected.seat.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="grow">{place}</span>
                <span className="tabular-nums">
                  {formatTicketPrice(selected.seat.priceCents ?? 0)}
                </span>
                <button
                  type="button"
                  onClick={andRefocus(() => {
                    onRemoveSeat(selected);
                  })}
                  className={REMOVE_CLASS}
                >
                  Remove <span className="sr-only">{place}</span>
                </button>
              </li>
            );
          })}
          {ga.map(({ section, quantity, cents }) => (
            <li key={section.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <span className="grow">
                {section.name}, {ticketCount(quantity)}
              </span>
              <span className="tabular-nums">{formatTicketPrice(cents)}</span>
              <button
                type="button"
                onClick={andRefocus(() => {
                  onRemoveGa(section.id);
                })}
                className={REMOVE_CLASS}
              >
                Remove <span className="sr-only">{section.name} tickets</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-300 pt-3">
        <dt>Tickets</dt>
        <dd className="text-right tabular-nums">
          {count.toString()} of {maxTickets.toString()}
        </dd>
        <dt className="font-semibold text-slate-900">Total</dt>
        <dd className="text-right font-semibold text-slate-900 tabular-nums">
          {formatPrice(totalCents)}
        </dd>
      </dl>
      {count >= maxTickets ? (
        <p className="text-sm">You’ve reached the limit of {ticketCount(maxTickets)} per order.</p>
      ) : (
        <p className="text-sm">Up to {ticketCount(maxTickets)} per order.</p>
      )}
      {count > 0 && (
        <button
          type="button"
          onClick={andRefocus(onClear)}
          className={`self-start ${REMOVE_CLASS}`}
        >
          Clear selection
        </button>
      )}
      {children}
    </section>
  );
}
