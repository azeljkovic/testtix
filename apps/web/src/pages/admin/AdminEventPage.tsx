import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALE } from '@testtix/shared';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ConfirmButton } from '../../admin/ConfirmButton.js';
import {
  BUTTON_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  StatusBadge,
  TABLE_CELL,
} from '../../admin/format.js';
import { adminQueries, eventChanged } from '../../admin/queries.js';
import {
  type AdminEvent,
  changeEventStatus,
  deleteEvent,
  type EventAction,
  type TicketCounts,
} from '../../api/admin.js';
import {
  CATEGORY_LABELS,
  formatEventDateTime,
  formatEventTimeRange,
  formatTicketPrice,
} from '../../catalogue/format.js';
import { FormAlert } from '../../forms/FormAlert.js';
import { errorMessage } from '../../forms/form-errors.js';
import { PageTitle } from '../../layout/PageTitle.js';
import { AdminNotFound } from './AdminNotFound.js';

const ACTION_DONE: Record<EventAction, string> = {
  publish: 'Published. The event is now in the public catalogue.',
  unpublish: 'Unpublished. The event is a draft again and has left the catalogue.',
  cancel: 'Cancelled. The event can no longer be changed.',
};

/** `/admin/events/:eventId`: an event's details, batches and status actions. */
export function AdminEventPage() {
  const { eventId = '' } = useParams();
  const event = useQuery(adminQueries.event(eventId));

  if (event.isPending) {
    return (
      <p role="status" className="text-slate-600">
        Loading event…
      </p>
    );
  }
  if (event.isError) {
    return <AdminNotFound what="event" error={event.error} retry={() => void event.refetch()} />;
  }
  return <EventDetails event={event.data} />;
}

function EventDetails({ event }: { event: AdminEvent }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string>();
  const timeZone = event.venue.timezone;

  const action = useMutation({
    mutationFn: (name: EventAction) => changeEventStatus(event.id, name),
    onMutate: () => {
      setDone(undefined);
    },
    onSuccess: async (updated, name) => {
      setDone(ACTION_DONE[name]);
      await eventChanged(queryClient, updated);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteEvent(event.id),
    onMutate: () => {
      setDone(undefined);
    },
    onSuccess: async () => {
      await navigate('/admin/events', { flushSync: true });
      queryClient.removeQueries({ queryKey: adminQueries.event(event.id).queryKey });
      await eventChanged(queryClient);
    },
  });
  const pending = action.isPending || remove.isPending;
  const error = action.error ?? remove.error;

  return (
    <>
      <PageTitle title={event.title} />
      <Link to="/admin/events" className={LINK_CLASS}>
        ‹ All events
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{event.title}</h1>
        <StatusBadge status={event.status} />
      </div>
      <p className="mt-1 text-lg text-slate-700">{event.performer}</p>

      <section aria-labelledby="actions-heading" className="mt-6">
        <h2 id="actions-heading" className="sr-only">
          Actions
        </h2>
        {/* Announced when it appears: the result of the last action. */}
        <div aria-live="polite" className="empty:hidden mb-4">
          {done !== undefined && (
            <p className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-900">
              {done}
            </p>
          )}
        </div>
        {error !== null && (
          <div className="mb-4">
            <FormAlert>{errorMessage(error)}</FormAlert>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {event.status !== 'CANCELLED' && (
            <>
              <Link to={`/admin/events/${event.id}/edit`} className={BUTTON_CLASS}>
                Edit
              </Link>
              <Link to={`/admin/events/${event.id}/batches/new`} className={BUTTON_CLASS}>
                Release tickets
              </Link>
            </>
          )}
          {event.status === 'DRAFT' && (
            <ActionButton
              primary
              pending={pending}
              onPress={() => {
                action.mutate('publish');
              }}
            >
              Publish
            </ActionButton>
          )}
          {event.status === 'PUBLISHED' && (
            <>
              <Link to={`/events/${event.slug}`} className={BUTTON_CLASS}>
                View in catalogue
              </Link>
              <ActionButton
                pending={pending}
                onPress={() => {
                  action.mutate('unpublish');
                }}
              >
                Unpublish
              </ActionButton>
            </>
          )}
          {event.status !== 'CANCELLED' && (
            <ConfirmButton
              label="Cancel event"
              title="Cancel this event?"
              confirmLabel="Cancel event"
              dismissLabel="Keep event"
              isDisabled={pending}
              onConfirm={() => {
                action.mutate('cancel');
              }}
            >
              <p>
                It stops selling tickets and can’t be changed, published or reopened afterwards.
                {event.status === 'PUBLISHED' && ' It stays visible to people who bought tickets.'}
              </p>
            </ConfirmButton>
          )}
          {event.status === 'DRAFT' && (
            <ConfirmButton
              label="Delete event"
              title="Delete this event?"
              confirmLabel="Delete event"
              dismissLabel="Keep event"
              isDisabled={pending}
              onConfirm={() => {
                remove.mutate();
              }}
            >
              <p>The draft and its ticket batches are deleted. This can’t be undone.</p>
            </ConfirmButton>
          )}
        </div>
        {event.status === 'DRAFT' && event.batches.length === 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Release a batch of tickets before publishing.
          </p>
        )}
      </section>

      <section aria-labelledby="details-heading" className="mt-10">
        <h2 id="details-heading" className="text-xl font-semibold">
          Details
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
          <Detail term="Category">{CATEGORY_LABELS[event.category]}</Detail>
          <Detail term="When">
            {formatEventTimeRange(event.startsAt, event.endsAt, timeZone)}
          </Detail>
          <Detail term="Venue">
            {event.venue.name}, {event.venue.city}
          </Detail>
          <Detail term="Sales open">{formatEventDateTime(event.salesOpenAt, timeZone)}</Detail>
          <Detail term="Public page">
            {event.status === 'PUBLISHED' ? (
              <Link to={`/events/${event.slug}`} className={LINK_CLASS}>
                /events/{event.slug}
              </Link>
            ) : (
              `/events/${event.slug}`
            )}
          </Detail>
          <Detail term="Seat holds last">{holdDuration(event.holdDurationSec)}</Detail>
          <Detail term="Tickets per order">Up to {event.maxTicketsPerOrder}</Detail>
          <Detail term="Tickets">{countsText(event.tickets)}</Detail>
        </dl>
        <p className="mt-6 max-w-3xl whitespace-pre-line text-slate-700">{event.description}</p>
      </section>

      <BatchTable event={event} />
    </>
  );
}

function ActionButton({
  children,
  pending,
  primary = false,
  onPress,
}: {
  children: ReactNode;
  pending: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-disabled={pending || undefined}
      onClick={() => {
        if (!pending) onPress();
      }}
      className={primary ? PRIMARY_BUTTON_CLASS : BUTTON_CLASS}
    >
      {children}
    </button>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-slate-600">{term}</dt>
      <dd className="text-slate-900">{children}</dd>
    </>
  );
}

/** "10 minutes", "90 seconds". */
function holdDuration(seconds: number): string {
  if (seconds % 60 !== 0) return `${String(seconds)} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

function count(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** "200 released: 180 available, 5 held, 15 sold". */
function countsText(tickets: TicketCounts): string {
  if (tickets.total === 0) return 'None released yet';
  return `${count(tickets.total)} released: ${count(tickets.available)} available, ${count(tickets.held)} held, ${count(tickets.sold)} sold`;
}

function BatchTable({ event }: { event: AdminEvent }) {
  const timeZone = event.venue.timezone;
  return (
    <section aria-labelledby="batches-heading" className="mt-10">
      <h2 id="batches-heading" className="text-xl font-semibold">
        Ticket batches
      </h2>
      {event.batches.length === 0 ? (
        <p className="mt-3 text-slate-700">No tickets released yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table aria-labelledby="batches-heading" className="w-full min-w-[48rem] border-collapse">
            <thead className="border-b border-slate-300 text-sm text-slate-600">
              <tr>
                <th scope="col" className={TABLE_CELL}>
                  Batch
                </th>
                <th scope="col" className={TABLE_CELL}>
                  Price
                </th>
                <th scope="col" className={TABLE_CELL}>
                  On sale from
                </th>
                <th scope="col" className={TABLE_CELL}>
                  Sections
                </th>
                <th scope="col" className={`${TABLE_CELL} text-right`}>
                  Tickets
                </th>
                <th scope="col" className={`${TABLE_CELL} text-right`}>
                  Available
                </th>
                <th scope="col" className={`${TABLE_CELL} text-right`}>
                  Held
                </th>
                <th scope="col" className={`${TABLE_CELL} text-right`}>
                  Sold
                </th>
              </tr>
            </thead>
            <tbody>
              {event.batches.map((batch) => (
                <tr key={batch.id} className="border-b border-slate-200">
                  <th scope="row" className={`${TABLE_CELL} font-medium`}>
                    {batch.name}
                  </th>
                  <td className={TABLE_CELL}>{formatTicketPrice(batch.priceCents)}</td>
                  <td className={TABLE_CELL}>
                    {formatEventDateTime(batch.releasesAt, timeZone)}
                    {!batch.released && (
                      <span className="block text-sm text-slate-600">Scheduled</span>
                    )}
                  </td>
                  <td className={TABLE_CELL}>
                    {batch.sections
                      .map((section) => `${section.name} (${count(section.tickets.total)})`)
                      .join(', ')}
                  </td>
                  <td className={`${TABLE_CELL} text-right tabular-nums`}>
                    {count(batch.tickets.total)}
                  </td>
                  <td className={`${TABLE_CELL} text-right tabular-nums`}>
                    {count(batch.tickets.available)}
                  </td>
                  <td className={`${TABLE_CELL} text-right tabular-nums`}>
                    {count(batch.tickets.held)}
                  </td>
                  <td className={`${TABLE_CELL} text-right tabular-nums`}>
                    {count(batch.tickets.sold)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
