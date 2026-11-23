import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HOLD_MESSAGES, type HoldRequest, formatPrice } from '@testtix/shared';
import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';

import type { CatalogueEvent } from '../api/catalogue.js';
import { ApiError } from '../api/errors.js';
import { createHold, type Hold, releaseHold, ticketsUnavailable } from '../api/holds.js';
import type {
  SeatMap,
  SeatMapGaSection,
  SeatMapRow,
  SeatMapSeat,
  SeatMapSeatedSection,
} from '../api/seats.js';
import { authPagePath } from '../auth/redirect.js';
import { SESSION_QUERY_KEY, useSession } from '../auth/session.js';
import { EventNotFound } from '../catalogue/EventNotFound.js';
import { formatEventDateTime, NOT_ON_SALE_NOTES, ticketCount } from '../catalogue/format.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { FormAlert } from '../forms/FormAlert.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { formatDuration, useCountdown } from '../seats/countdown.js';
import { GaStepper, type QuantitySource } from '../seats/GaStepper.js';
import { TimeLeft } from '../seats/HeldTickets.js';
import { HoldPanel } from '../seats/HoldPanel.js';
import { isQueueRequired, recheckAdmission, seatQueries } from '../seats/queries.js';
import { SeatGrid } from '../seats/SeatGrid.js';
import { SeatLegend } from '../seats/SeatGlyph.js';
import {
  EMPTY_SELECTION,
  holdRequest,
  pruneSelection,
  type Selection,
  seatPlace,
  summarize,
  unavailableTickets,
} from '../seats/selection.js';
import { SelectionSummary } from '../seats/SelectionSummary.js';
import { type Admission, queuePath, useAdmission } from '../waiting-room/admission.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

/**
 * `/events/:slug/seats`: the event's seat map. Seated sections are seat grids, GA sections quantity
 * steppers; the summary keeps a running total. A logged-in visitor holds the selection, and the hold
 * panel counts down to its expiry. A ticket drop's map is only for customers its waiting room has
 * let in: everyone else goes to the waiting room, and so do you once your admission ends.
 */
export function ChooseSeatsPage() {
  const { slug = '' } = useParams();
  const event = useQuery(catalogueQueries.event(slug));
  const eventId = event.data?.id;
  const admission = useAdmission(event.data);
  const seatMap = useQuery({
    ...seatQueries.seatMap(eventId ?? '', admission.token),
    enabled:
      eventId !== undefined && (admission.state === 'open' || admission.state === 'admitted'),
  });

  if (admission.state === 'queue') return <Navigate to={queuePath(slug)} replace />;

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
  return (
    <SeatPicker
      event={event.data}
      map={seatMap.data}
      admission={admission.state === 'admitted' ? admission : null}
    />
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

/** A failed hold, as shown above the hold button: a message, and what was taken (on a 409). */
interface HoldFailure {
  message: string;
  taken: string[];
}

/** Which part of the sidebar gets the focus when it appears. */
type SidebarFocus = 'hold' | 'selection' | null;

interface SeatPickerProps {
  event: CatalogueEvent;
  map: SeatMap;
  /** Your admission from a ticket drop's waiting room; null for other events. */
  admission: Extract<Admission, { state: 'admitted' }> | null;
}

function SeatPicker({ event, map, admission }: SeatPickerProps) {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [announcement, announce] = useAnnouncer();
  const queryClient = useQueryClient();
  const location = useLocation();
  const session = useSession();
  const loggedIn = session.data !== undefined && session.data !== null;
  const holdQuery = useQuery({ ...seatQueries.currentHold(map.eventId), enabled: loggedIn });
  const hold = loggedIn ? (holdQuery.data ?? null) : null;
  const [holdFailure, setHoldFailure] = useState<HoldFailure | null>(null);
  const [expired, setExpired] = useState(false);
  const [sidebarFocus, setSidebarFocus] = useState<SidebarFocus>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const refreshMap = () =>
    queryClient.invalidateQueries({ queryKey: seatQueries.seatMapKey(map.eventId) });
  const setHold = (next: Hold | null) => {
    queryClient.setQueryData(seatQueries.currentHold(map.eventId).queryKey, next);
  };

  const release = useMutation({
    mutationFn: releaseHold,
    onSuccess: () => {
      setHold(null);
      setSidebarFocus('selection');
      announce('Hold released. The tickets are available to others again.');
      void refreshMap();
    },
  });

  const create = useMutation({
    mutationFn: (request: HoldRequest) =>
      createHold(map.eventId, request, admission?.token ?? null),
    onSuccess: (created) => {
      release.reset();
      setHold(created);
      setSelection(EMPTY_SELECTION);
      setHoldFailure(null);
      setExpired(false);
      setSidebarFocus('hold');
      const durationSec = Math.round(
        (Date.parse(created.expiresAt) - Date.parse(created.createdAt)) / 1000,
      );
      announce(`${ticketCount(created.items.length)} held for ${formatDuration(durationSec)}.`);
      void refreshMap();
    },
    onError: (error) => {
      const unavailable = ticketsUnavailable(error);
      if (unavailable !== undefined) {
        setHoldFailure({
          message:
            'Someone else got some of these tickets first, so nothing was held. We’ve updated the map and your selection.',
          taken: unavailableTickets(map, unavailable),
        });
        void refreshMap();
        return;
      }
      if (isQueueRequired(error)) {
        // Your admission ended (or the event became a drop): the page goes to the waiting room.
        setHoldFailure({ message: errorMessage(error), taken: [] });
        void recheckAdmission(queryClient, map.eventId);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        setHoldFailure({
          message: 'Your session has ended. Log in again to hold tickets.',
          taken: [],
        });
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        return;
      }
      if (error instanceof ApiError && error.code === 'EVENT_NOT_ON_SALE') {
        void refreshMap();
        void queryClient.invalidateQueries({
          queryKey: catalogueQueries.event(event.slug).queryKey,
        });
      }
      setHoldFailure({ message: errorMessage(error), taken: [] });
    },
  });

  /** The hold ran out (by the browser clock): clear everything and show the map as it is now. */
  const expire = () => {
    const hadFocus = sidebarRef.current?.contains(document.activeElement) ?? false;
    release.reset();
    setHold(null);
    setSelection(EMPTY_SELECTION);
    setExpired(true);
    setSidebarFocus(hadFocus ? 'selection' : null);
    void refreshMap();
  };

  // A refreshed map may have taken seats or places away: drop them from the selection.
  const [shownMap, setShownMap] = useState(map);
  if (map !== shownMap) {
    setShownMap(map);
    setSelection(pruneSelection(map, selection));
  }

  const summary = summarize(map, selection);
  const onSale = map.availability === 'ON_SALE';
  // While tickets are held, the map is read-only: a hold is changed by releasing it and holding again.
  const selectable = onSale && hold === null;
  const maxTickets = map.maxTicketsPerOrder;
  const selectedSeats = new Set(summary.seats.map(({ seat }) => seat.id));
  // The venue's sections in which the event sells tickets (now or in a scheduled release).
  const eventSections = new Set(event.sections.map(({ id }) => id));
  const sections = map.sections.filter(({ id }) => eventSections.has(id));
  const hasSeats = sections.some(({ type }) => type === 'SEATED');
  const heading = event.seating === 'GA' ? 'Choose tickets' : 'Choose seats';
  const holdLabel = event.seating === 'GA' ? 'Hold tickets' : 'Hold seats';

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
      {admission !== null && (
        <AdmissionNote
          key={admission.expiresAt}
          expiresAt={admission.expiresAt}
          onEnd={() => void recheckAdmission(queryClient, map.eventId)}
        />
      )}
      {map.availability !== 'ON_SALE' && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
          {NOT_ON_SALE_NOTES[map.availability]} The map shows each seat’s current status.
        </p>
      )}
      {expired && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <p className="font-semibold">Your hold expired</p>
          <p className="mt-1">
            The tickets were released, and the map now shows what’s available. Choose your tickets
            and hold them again.
          </p>
        </div>
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
        <div ref={sidebarRef}>
          <div className="lg:sticky lg:top-6">
            {hold !== null ? (
              <HoldPanel
                key={hold.id}
                hold={hold}
                checkoutHref={`/events/${event.slug}/checkout`}
                focusOnMount={sidebarFocus === 'hold'}
                onExpire={expire}
                onLastMinute={() => {
                  announce('Less than a minute left on your hold.');
                }}
                onRelease={() => {
                  release.mutate(hold.id);
                }}
                isReleasing={release.isPending}
                releaseError={release.isError ? errorMessage(release.error) : undefined}
              />
            ) : (
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
                focusOnMount={sidebarFocus === 'selection'}
              >
                {onSale && (
                  <div className="flex flex-col gap-3 border-t border-slate-300 pt-4">
                    {holdFailure !== null && (
                      <FormAlert>
                        <p>{holdFailure.message}</p>
                        {holdFailure.taken.length > 0 && (
                          <ul
                            aria-label="Tickets no longer available"
                            className="mt-2 list-disc pl-5"
                          >
                            {holdFailure.taken.map((ticket) => (
                              <li key={ticket}>{ticket}</li>
                            ))}
                          </ul>
                        )}
                      </FormAlert>
                    )}
                    {session.data === null ? (
                      <Link to={authPagePath('/login', location)} className={LINK_CLASS}>
                        Log in to hold tickets
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={summary.count === 0 || !loggedIn || holdQuery.isPending}
                        aria-disabled={create.isPending || undefined}
                        onClick={() => {
                          if (!create.isPending) create.mutate(holdRequest(summary));
                        }}
                        className="rounded-md bg-indigo-700 px-5 py-2.5 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400 aria-disabled:cursor-wait aria-disabled:opacity-70"
                      >
                        {create.isPending ? 'Holding…' : holdLabel}
                      </button>
                    )}
                  </div>
                )}
              </SelectionSummary>
            )}
          </div>
        </div>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

/**
 * A ticket drop's admission: the time left to hold tickets (browser clock, like the hold panel).
 * When it runs out the queue entry is checked again, and once the API agrees it has ended the page
 * goes to the waiting room. Keyed by `expiresAt`.
 */
function AdmissionNote({ expiresAt, onEnd }: { expiresAt: string; onEnd: () => void }) {
  const left = useCountdown(expiresAt, { onExpire: onEnd });
  return (
    <section
      aria-labelledby="admission-heading"
      className="mt-4 flex max-w-2xl flex-col gap-3 rounded-md border border-sky-300 bg-sky-50 p-4 text-sky-950"
    >
      <h2 id="admission-heading" className="font-semibold">
        It’s your turn
      </h2>
      <p>
        The waiting room has let you in. Hold your tickets before your turn ends; once they’re held,
        the hold’s own timer gives you time to check out.
      </p>
      <TimeLeft seconds={left} label="Your turn ends in" />
    </section>
  );
}
