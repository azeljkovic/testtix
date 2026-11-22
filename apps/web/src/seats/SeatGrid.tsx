import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';

import type { SeatMapRow, SeatMapSeat, SeatMapSeatedSection } from '../api/seats.js';
import { formatPriceRange } from '../catalogue/format.js';
import { type GridPosition, nextPosition } from './grid-navigation.js';
import { SeatGlyphContent, seatGlyphClass } from './SeatGlyph.js';
import { seatName, seatState } from './selection.js';

interface SeatGridProps {
  section: SeatMapSeatedSection;
  /** IDs of the seats the visitor picked. */
  selected: ReadonlySet<string>;
  /** Whether seats can be picked (the event is on sale). Otherwise the grid is read-only. */
  selectable: boolean;
  onToggle: (section: SeatMapSeatedSection, row: SeatMapRow, seat: SeatMapSeat) => void;
}

/** The first available seat, where the grid's tab stop starts; the first seat if none is. */
function initialPosition(section: SeatMapSeatedSection): GridPosition {
  for (const [row, { seats }] of section.rows.entries()) {
    const col = seats.findIndex((seat) => seat.status === 'AVAILABLE');
    if (col !== -1) return { row, col };
  }
  return { row: 0, col: 0 };
}

/** The grid position of the seat an event happened on, from its `data-row` / `data-col`. */
function cellPosition(target: EventTarget): GridPosition | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const cell = target.closest<HTMLElement>('[data-col]');
  if (cell === null) return undefined;
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

/** "$45.00", "$45.00 – $89.00", or nothing when no seat of the section has a price. */
function sectionPrices(section: SeatMapSeatedSection): string | undefined {
  const prices = section.rows.flatMap(({ seats }) =>
    seats.flatMap(({ priceCents }) => (priceCents === null ? [] : [priceCents])),
  );
  if (prices.length === 0) return undefined;
  return formatPriceRange({ minCents: Math.min(...prices), maxCents: Math.max(...prices) });
}

/**
 * One seated section as an ARIA grid: a row per seat row (with a row header) and a cell per seat.
 * The grid is one tab stop (roving tabindex); arrow keys, Home / End and Ctrl+Home / Ctrl+End move
 * between seats, and Enter or Space toggles the focused seat. Unavailable seats can be focused, so
 * their status can be read, but not picked.
 */
export function SeatGrid({ section, selected, selectable, onToggle }: SeatGridProps) {
  const headingId = useId();
  const descriptionId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => initialPosition(section));

  const rowLengths = section.rows.map(({ seats }) => seats.length);
  const seatCount = rowLengths.reduce((sum, length) => sum + length, 0);
  const prices = sectionPrices(section);

  const seatAt = ({ row, col }: GridPosition) => {
    const seatRow = section.rows[row];
    const seat = seatRow?.seats[col];
    return seatRow && seat ? { row: seatRow, seat } : undefined;
  };
  // The tab stop, kept on an existing seat.
  const tabStop = seatAt(active) ? active : { row: 0, col: 0 };

  const toggle = (position: GridPosition) => {
    const target = seatAt(position);
    if (selectable && target) onToggle(section, target.row, target.seat);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const position = cellPosition(event.target);
    if (position === undefined) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle(position);
      return;
    }
    const next = nextPosition(rowLengths, position, event.key, event.ctrlKey || event.metaKey);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    gridRef.current
      ?.querySelector<HTMLElement>(
        `[data-row="${next.row.toString()}"][data-col="${next.col.toString()}"]`,
      )
      ?.focus();
  };

  const onFocus = (event: SyntheticEvent) => {
    const position = cellPosition(event.target);
    if (position !== undefined) setActive(position);
  };

  const onClick = (event: SyntheticEvent) => {
    const position = cellPosition(event.target);
    if (position !== undefined) toggle(position);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xl font-semibold">
        {section.name}
      </h2>
      <p id={descriptionId} className="text-sm text-slate-600">
        {section.available.toString()} of {seatCount.toString()} seats available
        {prices !== undefined && ` · ${prices}`}
      </p>
      <div className="overflow-x-auto pb-2">
        <div
          ref={gridRef}
          role="grid"
          aria-labelledby={headingId}
          aria-describedby={descriptionId}
          aria-multiselectable={selectable ? true : undefined}
          aria-readonly={selectable ? undefined : true}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onClick={onClick}
          className="inline-flex flex-col gap-1 p-1"
        >
          {section.rows.map((row, rowIndex) => (
            <div key={row.label} role="row" className="flex items-center gap-1">
              <div
                role="rowheader"
                className="w-8 shrink-0 pr-1 text-right text-xs font-medium text-slate-600"
              >
                <span className="sr-only">Row </span>
                {row.label}
              </div>
              {row.seats.map((seat, col) => {
                const state = seatState(seat, selected.has(seat.id));
                const pickable = selectable && (state === 'AVAILABLE' || state === 'SELECTED');
                const isTabStop = tabStop.row === rowIndex && tabStop.col === col;
                return (
                  <div
                    key={seat.id}
                    role="gridcell"
                    tabIndex={isTabStop ? 0 : -1}
                    aria-label={seatName(section.name, row.label, seat, state)}
                    aria-selected={pickable ? state === 'SELECTED' : undefined}
                    aria-disabled={selectable && !pickable ? true : undefined}
                    data-row={rowIndex}
                    data-col={col}
                    className={`${seatGlyphClass(state)} ${pickable ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300' : 'cursor-default'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
                  >
                    <SeatGlyphContent state={state} number={seat.number} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
