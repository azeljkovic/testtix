import { useQuery } from '@tanstack/react-query';
import { HOLD_MESSAGES, formatPrice } from '@testtix/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import type { CatalogueEvent } from '../api/catalogue.js';
import { ApiError } from '../api/errors.js';
import type {
  SeatMap,
  SeatMapGaSection,
  SeatMapRow,
  SeatMapSeat,
  SeatMapSeatedSection,
} from '../api/seats.js';
import { formatEventDateTime, NOT_ON_SALE_NOTES, ticketCount } from '../catalogue/format.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { GaStepper, type QuantitySource } from '../seats/GaStepper.js';
import { seatQueries } from '../seats/queries.js';
import { SeatGrid } from '../seats/SeatGrid.js';
import { SeatLegend } from '../seats/SeatGlyph.js';
import {
  EMPTY_SELECTION,
  pruneSelection,
  type Selection,
  seatPlace,
  summarize,
} from '../seats/selection.js';
import { SelectionSummary } from '../seats/SelectionSummary.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

/**
 * `/events/:slug/seats`: the event's seat map. Seated sections are seat grids, GA sections quantity
 * steppers; the summary keeps a running total. Holding the selection arrives with C3.4.
 */
export function ChooseSeatsPage() {
  const { slug = '' } = useParams();
  const event = useQuery(catalogueQueries.event(slug));
  const eventId = event.data?.id;
  const seatMap = useQuery({
    ...seatQueries.seatMap(eventId ?? ''),
    enabled: eventId !== undefined,
  });

  const error = event.error ?? seatMap.error;
  if (error !== null) {
    if (error instanceof ApiError && error.status === 404) return <EventNotFound />;
    return (
      <>
        <PageTitle title="Seat map unavailable" />
        <h1 className="text-3xl font-bold tracking-tight">We couldn’t load the seat map</h1>
        <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
          <p>{errorMessage(error)}</p>
          <button
            type="button"
            onClick={() => void (event.isError ? event.refetch() : seatMap.refetch())}
            className={LINK_CLASS}
          >
            Try again
          </button>
        </div>
      </>
    );
  }
  if (event.data === undefined || seatMap.data === undefined) {
    return (
      <>
        <PageTitle title="Loading seat map" />
        <p role="status" className="text-slate-600">
          Loading seat map…
        </p>
      </>
    );
  }
  return <SeatPicker event={event.data} map={seatMap.data} />;
}

function EventNotFound() {
  return (
    <>
      <PageTitle title="Event not found" />
      <h1 className="text-3xl font-bold tracking-tight">Event not found</h1>
      <p className="mt-4 text-slate-600">
        There’s no event at this address. It may have been unpublished or cancelled.
      </p>
      <Link to="/events" className={`mt-6 inline-block ${LINK_CLASS}`}>
        Browse all events
      </Link>
    </>
  );
}

/**
 * Text for the live region. Saying the same thing twice in a row (hitting the ticket limit again)
 * appends a no-break space, so screen readers notice the change and repeat it.
 */
function useAnnouncer() {
  const [message, setMessage] = useState('');
  const announce = (text: string) => {
    setMessage((previous) => (previous === text ? `${text}\u00a0` : text));
  };
  return [message, announce] as const;
}

function SeatPicker({ event, map }: { event: CatalogueEvent; map: SeatMap }) {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [announcement, announce] = useAnnouncer();

  // A refreshed map may have taken seats or places away: drop them from the selection.
  const [shownMap, setShownMap] = useState(map);
  if (map !== shownMap) {
    setShownMap(map);
    setSelection(pruneSelection(map, selection));
  }

  const summary = summarize(map, selection);
  const selectable = map.availability === 'ON_SALE';
  const maxTickets = map.maxTicketsPerOrder;
  const selectedSeats = new Set(summary.seats.map(({ seat }) => seat.id));
  // The venue's sections in which the event sells tickets (now or in a scheduled release).
  const eventSections = new Set(event.sections.map(({ id }) => id));
  const sections = map.sections.filter(({ id }) => eventSections.has(id));
  const hasSeats = sections.some(({ type }) => type === 'SEATED');
  const heading = event.seating === 'GA' ? 'Choose tickets' : 'Choose seats';

  /** Changes the selection and announces `what` with the new ticket count and total. */
  const update = (next: Selection, what: string) => {
    setSelection(next);
    const { count, totalCents } = summarize(map, next);
    announce(`${what} ${ticketCount(count)}, ${formatPrice(totalCents)} in total.`);
  };

  const toggleSeat = (section: SeatMapSeatedSection, row: SeatMapRow, seat: SeatMapSeat) => {
    const place = seatPlace(section.name, row.label, seat.number);
    if (selectedSeats.has(seat.id)) {
      update(
        { ...selection, seats: selection.seats.filter((id) => id !== seat.id) },
        `Removed ${place}.`,
      );
    } else if (seat.status !== 'AVAILABLE') {
      return;
    } else if (summary.count >= maxTickets) {
      announce(`${HOLD_MESSAGES.tooMany(maxTickets)}.`);
    } else {
      update({ ...selection, seats: [...selection.seats, seat.id] }, `Added ${place}.`);
    }
  };

  const setGaQuantity = (section: SeatMapGaSection, quantity: number, source: QuantitySource) => {
    const next = { ...selection, ga: { ...selection.ga, [section.id]: quantity } };
    // Screen readers read a focused spin button's new value themselves; the − / + buttons need help.
    if (source === 'input') setSelection(next);
    else update(next, `${section.name}: ${ticketCount(quantity)}.`);
  };

  const gaQuantity = (sectionId: string) =>
    summary.ga.find(({ section }) => section.id === sectionId)?.quantity ?? 0;

  return (
    <>
      <PageTitle title={`${heading}: ${event.title}`} />
      <Link to={`/events/${event.slug}`} className={LINK_CLASS}>
        ‹ Back to the event
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">{heading}</h1>
      <p className="mt-2 text-lg text-slate-700">
        {event.title} ·{' '}
        <time dateTime={event.startsAt}>
          {formatEventDateTime(event.startsAt, event.venue.timezone)}
        </time>{' '}
        · {event.venue.name}
      </p>
      {map.availability !== 'ON_SALE' && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
          {NOT_ON_SALE_NOTES[map.availability]} The map shows each seat’s current status.
        </p>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {hasSeats && (
            <>
              <SeatLegend />
              <p className="text-sm text-slate-600">
                Rows are lettered from the stage: row A is at the front. In a seat map, the arrow
                keys move between seats and Enter or Space chooses one.
              </p>
              <div className="rounded-md bg-slate-200 py-2 text-center text-sm font-semibold tracking-widest text-slate-700 uppercase">
                Stage
              </div>
            </>
          )}
          {sections.length === 0 && <p>No tickets have been released for this event yet.</p>}
          {sections.map((section) =>
            section.type === 'SEATED' ? (
              <SeatGrid
                key={section.id}
                section={section}
                selected={selectedSeats}
                selectable={selectable}
                onToggle={toggleSeat}
              />
            ) : (
              <GaStepper
                key={section.id}
                section={section}
                quantity={gaQuantity(section.id)}
                max={Math.min(
                  section.available,
                  gaQuantity(section.id) + Math.max(maxTickets - summary.count, 0),
                )}
                selectable={selectable}
                onChange={setGaQuantity}
              />
            ),
          )}
        </div>
        <div>
          <div className="lg:sticky lg:top-6">
            <SelectionSummary
              summary={summary}
              maxTickets={maxTickets}
              onRemoveSeat={({ section, row, seat }) => {
                toggleSeat(section, row, seat);
              }}
              onRemoveGa={(sectionId) => {
                const name = sections.find(({ id }) => id === sectionId)?.name ?? '';
                update(
                  { ...selection, ga: { ...selection.ga, [sectionId]: 0 } },
                  `Removed ${name} tickets.`,
                );
              }}
              onClear={() => {
                update(EMPTY_SELECTION, 'Selection cleared.');
              }}
            />
          </div>
        </div>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
