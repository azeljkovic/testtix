import { useId, useState, type KeyboardEvent } from 'react';

import type { SeatMapGaSection } from '../api/seats.js';
import { formatPriceRange, formatTicketPrice, ticketCount } from '../catalogue/format.js';

/** Where a quantity change came from: the − / + buttons, or the spin button itself (keys, typing). */
export type QuantitySource = 'button' | 'input';

interface GaStepperProps {
  section: SeatMapGaSection;
  quantity: number;
  /** The most this section's quantity can be: its places left, within the order's ticket limit. */
  max: number;
  /** Whether places can be picked (the event is on sale). */
  selectable: boolean;
  onChange: (section: SeatMapGaSection, quantity: number, source: QuantitySource) => void;
}

/** How far Page Up / Page Down move the quantity. */
const PAGE_STEP = 5;

/** "$10.00 each", or "$10.00 – $15.00, cheapest first" when the places left have several prices. */
function priceText(prices: SeatMapGaSection['prices']): string {
  const first = prices[0];
  const last = prices.at(-1);
  if (first === undefined || last === undefined) return '';
  return first === last
    ? `${formatTicketPrice(first.priceCents)} each`
    : `${formatPriceRange({ minCents: first.priceCents, maxCents: last.priceCents })}, cheapest first`;
}

const STEP_BUTTON_CLASS =
  'flex size-10 items-center justify-center text-xl font-semibold text-indigo-800 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900 aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent';

/**
 * A general-admission section: a quantity stepper instead of a seat grid. It is a hand-built ARIA
 * spin button (an input with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`): Arrow Up / Down
 * change the quantity by one, Page Up / Down by five, Home / End go to 0 / the maximum, and a typed
 * number is kept within the limits when the field loses focus or Enter is pressed. The − / + buttons
 * stay focusable at the limits (`aria-disabled`), so the focus isn't lost when one stops working.
 */
export function GaStepper({ section, quantity, max, selectable, onChange }: GaStepperProps) {
  const headingId = useId();
  const inputId = useId();
  const descriptionId = useId();
  // What the visitor is typing, until it is committed.
  const [draft, setDraft] = useState<string | null>(null);

  const soldOut = section.available === 0;
  const disabled = !selectable || soldOut;
  const description = soldOut
    ? 'None left right now.'
    : `${ticketCount(section.available)} left · ${priceText(section.prices)} · up to ${max.toString()} for this order`;

  const clamp = (value: number) => Math.min(Math.max(value, 0), max);
  const change = (value: number, source: QuantitySource) => {
    const next = clamp(value);
    if (next !== quantity) onChange(section, next, source);
  };

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const typed = Number.parseInt(draft.trim(), 10);
    if (!Number.isNaN(typed)) change(typed, 'input');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowUp: quantity + 1,
      ArrowDown: quantity - 1,
      PageUp: quantity + PAGE_STEP,
      PageDown: quantity - PAGE_STEP,
      Home: 0,
      End: max,
    };
    if (event.key === 'Enter') {
      commit();
      return;
    }
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setDraft(null);
    change(next, 'input');
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xl font-semibold">
        {section.name}
      </h2>
      <p className="text-sm text-slate-600">General admission: no assigned seats.</p>
      <label htmlFor={inputId} className="font-medium text-slate-900">
        {section.name} tickets
      </label>
      <div
        className={`flex items-stretch self-start overflow-hidden rounded-md border border-slate-400 ${disabled ? 'bg-slate-100' : 'bg-white'}`}
      >
        <button
          type="button"
          aria-label={`Remove a ${section.name} ticket`}
          aria-disabled={!disabled && quantity <= 0 ? true : undefined}
          disabled={disabled}
          onClick={() => {
            change(quantity - 1, 'button');
          }}
          className={STEP_BUTTON_CLASS}
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          id={inputId}
          type="text"
          role="spinbutton"
          inputMode="numeric"
          autoComplete="off"
          aria-valuenow={quantity}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-describedby={descriptionId}
          disabled={disabled}
          value={draft ?? quantity.toString()}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-16 border-x border-slate-300 bg-transparent text-center text-lg tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900 disabled:text-slate-500"
        />
        <button
          type="button"
          aria-label={`Add a ${section.name} ticket`}
          aria-disabled={!disabled && quantity >= max ? true : undefined}
          disabled={disabled}
          onClick={() => {
            change(quantity + 1, 'button');
          }}
          className={STEP_BUTTON_CLASS}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p id={descriptionId} className="text-sm text-slate-600">
        {description}
      </p>
    </section>
  );
}
