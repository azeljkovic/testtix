import { SEAT_STATES, type SeatState } from './selection.js';

/**
 * Each state has its own shape or icon as well as its own colour, so the map never relies on colour
 * alone: available seats show their number in an outline, selected ones a tick, held ones a clock,
 * sold ones a cross, and seats that aren't on sale are an empty dashed outline.
 */
const STATE_CLASSES: Record<SeatState, string> = {
  AVAILABLE: 'border-2 border-indigo-600 bg-white text-indigo-900',
  SELECTED: 'border-2 border-indigo-700 bg-indigo-700 text-white',
  HELD: 'border-2 border-amber-600 bg-amber-100 text-amber-900',
  SOLD: 'border-2 border-slate-500 bg-slate-300 text-slate-800',
  NOT_ON_SALE: 'border border-dashed border-slate-400 bg-transparent text-slate-400',
};

export const SEAT_GLYPH_CLASS =
  'flex size-7 shrink-0 items-center justify-center rounded-md text-[0.625rem] font-semibold tabular-nums';

export function seatGlyphClass(state: SeatState): string {
  return `${SEAT_GLYPH_CLASS} ${STATE_CLASSES[state]}`;
}

const ICON_PROPS = {
  viewBox: '0 0 16 16',
  className: 'size-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** What a seat shows inside its outline. Decorative: the seat's accessible name says it in words. */
export function SeatGlyphContent({ state, number }: { state: SeatState; number?: number }) {
  switch (state) {
    case 'AVAILABLE':
      return <span aria-hidden="true">{number}</span>;
    case 'SELECTED':
      return (
        <svg {...ICON_PROPS}>
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      );
    case 'HELD':
      return (
        <svg {...ICON_PROPS}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" />
        </svg>
      );
    case 'SOLD':
      return (
        <svg {...ICON_PROPS}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case 'NOT_ON_SALE':
      return null;
  }
}

const LEGEND_LABELS: Record<SeatState, string> = {
  AVAILABLE: 'Available',
  SELECTED: 'Selected',
  HELD: 'Held',
  SOLD: 'Sold',
  NOT_ON_SALE: 'Not on sale',
};

/** The key to the seat states. */
export function SeatLegend() {
  return (
    <section aria-labelledby="seat-key-heading">
      <h2 id="seat-key-heading" className="text-sm font-semibold text-slate-900">
        Seat key
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
        {SEAT_STATES.map((state) => (
          <li key={state} className="flex items-center gap-2">
            <span className={seatGlyphClass(state)}>
              <SeatGlyphContent state={state} number={1} />
            </span>
            {LEGEND_LABELS[state]}
          </li>
        ))}
      </ul>
    </section>
  );
}
