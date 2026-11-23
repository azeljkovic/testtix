import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALE, type QueueStatus } from '@testtix/shared';
import { type RefObject, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router';

import type { CatalogueEvent } from '../api/catalogue.js';
import { ApiError } from '../api/errors.js';
import { joinQueue, type QueueEntry } from '../api/waiting-room.js';
import { EventNotFound } from '../catalogue/EventNotFound.js';
import { formatEventDateTime, ticketCount } from '../catalogue/format.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { FormAlert } from '../forms/FormAlert.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { seatQueries } from '../seats/queries.js';
import { formatWait, positionSentence } from '../waiting-room/format.js';
import { queueQueries } from '../waiting-room/queries.js';
import { SalesCountdown } from '../waiting-room/SalesCountdown.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';
const BUTTON_CLASS =
  'self-start rounded-md bg-indigo-700 px-5 py-2.5 font-semibold text-white hover:bg-indigo-800 aria-disabled:cursor-wait aria-disabled:opacity-70';

/** The heading of each status shown here (`ADMITTED` goes straight to the seat map): also the page title. */
const STATUS_HEADINGS: Record<Exclude<QueueStatus, 'ADMITTED'>, string> = {
  PRE_SALE: 'You’re in the waiting room',
  WAITING: 'You’re in the queue',
  EXPIRED: 'Your turn has ended',
};

const STATUS_PANEL_CLASS: Record<Exclude<QueueStatus, 'ADMITTED'>, string> = {
  PRE_SALE: 'border-sky-300 bg-sky-50 text-sky-950',
  WAITING: 'border-sky-300 bg-sky-50 text-sky-950',
  EXPIRED: 'border-amber-300 bg-amber-50 text-amber-950',
};

/**
 * `/events/:slug/queue`: a ticket drop's waiting room. Opening it joins the queue (or picks up your
 * place in it); the page polls your place every `retryAfterMs` and goes to the seat map once you're
 * let in. Events without a waiting room go straight to the seat map. Behind `RequireAuth`.
 */
export function WaitingRoomPage() {
  const { slug = '' } = useParams();
  const event = useQuery(catalogueQueries.event(slug));
  const drop = event.data?.waitingRoomEnabled === true;
  const entry = useQuery({ ...queueQueries.entry(event.data?.id ?? ''), enabled: drop });
  const seatsPath = `/events/${slug}/seats`;

  if (event.isError) {
    if (event.error instanceof ApiError && event.error.status === 404) return <EventNotFound />;
    return <LoadError error={event.error} retry={() => void event.refetch()} />;
  }
  if (event.data === undefined) return <Loading text="Loading event…" />;
  if (!drop) return <Navigate to={seatsPath} replace />;

  if (entry.data === undefined) {
    if (!entry.isError) return <Loading text="Joining the queue…" />;
    const { error } = entry;
    if (error instanceof ApiError) {
      // The event no longer has a waiting room: the event is being fetched again.
      if (error.code === 'NO_WAITING_ROOM') return <Loading text="Loading event…" />;
      if (error.status === 404) return <EventNotFound />;
      if (error.code === 'EVENT_NOT_ON_SALE') return <SalesEnded event={event.data} />;
    }
    return <LoadError error={error} retry={() => void entry.refetch()} />;
  }
  if (entry.data.status === 'ADMITTED') return <Navigate to={seatsPath} replace />;

  return (
    <QueueView
      event={event.data}
      entry={entry.data}
      status={entry.data.status}
      onSalesOpen={() => void entry.refetch()}
      // A failed poll keeps the last answer on screen; polling carries on.
      pollError={entry.isError ? errorMessage(entry.error) : undefined}
    />
  );
}

function Loading({ text }: { text: string }) {
  return (
    <>
      <PageTitle title="Waiting room" />
      <p role="status" className="text-slate-600">
        {text}
      </p>
    </>
  );
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageTitle title="Waiting room unavailable" />
      <h1 className="text-3xl font-bold tracking-tight">We couldn’t get you into the queue</h1>
      <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
        <p>{errorMessage(error)}</p>
        <button type="button" onClick={retry} className={LINK_CLASS}>
          Try again
        </button>
      </div>
    </>
  );
}

function SalesEnded({ event }: { event: CatalogueEvent }) {
  return (
    <>
      <PageTitle title="Sales have ended" />
      <h1 className="text-3xl font-bold tracking-tight">Sales have ended</h1>
      <p className="mt-4 text-slate-700">
        {event.title} has started, so its waiting room is closed and tickets are no longer sold.
      </p>
      <Link to={`/events/${event.slug}`} className={`mt-6 inline-block ${LINK_CLASS}`}>
        Back to the event
      </Link>
    </>
  );
}

interface QueueViewProps {
  event: CatalogueEvent;
  entry: QueueEntry;
  status: Exclude<QueueStatus, 'ADMITTED'>;
  /** Called when sales open by the browser clock. */
  onSalesOpen: () => void;
  pollError: string | undefined;
}

function QueueView({ event, entry, status, onSalesOpen, pollError }: QueueViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { timezone } = event.venue;

  return (
    <>
      <PageTitle title={STATUS_HEADINGS[status]} />
      <Link to={`/events/${event.slug}`} className={LINK_CLASS}>
        ‹ Back to the event
      </Link>
      <p className="mt-6 text-lg text-slate-700">
        {event.title} ·{' '}
        <time dateTime={event.startsAt}>{formatEventDateTime(event.startsAt, timezone)}</time> ·{' '}
        {event.venue.name}
      </p>
      {/* One live region for the status and your place, so each change is announced. */}
      <div
        role="status"
        className={`mt-4 flex max-w-2xl flex-col gap-2 rounded-lg border p-5 ${STATUS_PANEL_CLASS[status]}`}
      >
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight">
          {STATUS_HEADINGS[status]}
        </h1>
        <StatusMessage event={event} entry={entry} status={status} />
      </div>
      {pollError !== undefined && (
        <p className="mt-3 text-sm text-slate-700">
          We couldn’t check for updates: {pollError} We’ll keep trying.
        </p>
      )}

      <div className="mt-6 flex max-w-2xl flex-col gap-4">
        {status === 'PRE_SALE' && (
          <SalesCountdown
            key={entry.salesOpenAt}
            salesOpenAt={entry.salesOpenAt}
            onOpen={onSalesOpen}
          />
        )}
        {status === 'WAITING' && entry.position !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="font-medium text-slate-600">Your place</dt>
            <dd className="tabular-nums">{entry.position.toLocaleString(LOCALE)}</dd>
            <dt className="font-medium text-slate-600">People in the queue</dt>
            <dd className="tabular-nums">{entry.queueLength.toLocaleString(LOCALE)}</dd>
            <dt className="font-medium text-slate-600">Estimated wait</dt>
            <dd>{formatWait(entry.estimatedWaitMs ?? 0)}</dd>
          </dl>
        )}
        {status === 'EXPIRED' ? (
          <Expired event={event} headingRef={headingRef} />
        ) : (
          <p className="text-slate-700">
            Keep this page open: when it’s your turn, we’ll take you to the seat map. Leaving the
            page doesn’t cost you your place.
          </p>
        )}
      </div>
    </>
  );
}

function StatusMessage({
  event,
  entry,
  status,
}: {
  event: CatalogueEvent;
  entry: QueueEntry;
  status: Exclude<QueueStatus, 'ADMITTED'>;
}) {
  switch (status) {
    case 'PRE_SALE':
      return (
        <p>
          Sales open{' '}
          <time dateTime={entry.salesOpenAt}>
            {formatEventDateTime(entry.salesOpenAt, event.venue.timezone)}
          </time>
          . Everyone who joins before then gets a place in a random order when sales open, so
          joining early doesn’t put you ahead.
        </p>
      );
    case 'WAITING':
      return (
        <p>{entry.position === null ? 'You’re in the queue.' : positionSentence(entry.position)}</p>
      );
    case 'EXPIRED':
      return (
        <p>
          Your time to choose tickets ran out. Join the queue again for another turn: you’ll start
          at the back.
        </p>
      );
  }
}

/** The way back into the queue, and the tickets you still hold (holds outlast an admission). */
function Expired({
  event,
  headingRef,
}: {
  event: CatalogueEvent;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const hold = useQuery(seatQueries.currentHold(event.id));
  const rejoin = useMutation({
    mutationFn: () => joinQueue(event.id),
    onSuccess: (entry) => {
      queryClient.setQueryData(queueQueries.entry(event.id).queryKey, entry);
      // The button goes: keep the focus on the page, at its new heading.
      headingRef.current?.focus();
    },
  });

  return (
    <>
      {hold.data !== undefined && hold.data !== null && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <p>
            You still have {ticketCount(hold.data.items.length)} on hold. Your hold lasts until its
            own timer runs out, so you can still check out.
          </p>
          <Link to={`/events/${event.slug}/checkout`} className={LINK_CLASS}>
            Check out
          </Link>
        </div>
      )}
      {rejoin.isError && <FormAlert>{errorMessage(rejoin.error)}</FormAlert>}
      <button
        type="button"
        aria-disabled={rejoin.isPending || undefined}
        onClick={() => {
          if (!rejoin.isPending) rejoin.mutate();
        }}
        className={BUTTON_CLASS}
      >
        {rejoin.isPending ? 'Joining…' : 'Join the queue again'}
      </button>
    </>
  );
}
