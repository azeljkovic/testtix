import { useQuery } from '@tanstack/react-query';
import { EVENT_STATUSES, EventStatusSchema, LOCALE } from '@testtix/shared';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router';

import {
  STATUS_LABELS,
  StatusBadge,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  TABLE_CELL,
} from '../../admin/format.js';
import { adminQueries } from '../../admin/queries.js';
import { formatEventDateTime } from '../../catalogue/format.js';
import { Pagination } from '../../catalogue/Pagination.js';
import { errorMessage } from '../../forms/form-errors.js';
import { PageTitle } from '../../layout/PageTitle.js';
import type { AdminEventSummary } from '../../api/admin.js';

/** `?status=DRAFT&page=2`; values the API wouldn't accept are ignored. */
function parseParams(searchParams: URLSearchParams) {
  const status = EventStatusSchema.safeParse(searchParams.get('status')).data;
  const page = Number(searchParams.get('page'));
  return { status, page: Number.isInteger(page) && page > 1 ? page : 1 };
}

function toSearch({ status, page }: ReturnType<typeof parseParams>): string {
  const params = new URLSearchParams();
  if (status !== undefined) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  return params.size === 0 ? '' : `?${params.toString()}`;
}

/** Every event, drafts and cancelled ones included, by start time. */
export function AdminEventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseParams(searchParams);
  const events = useQuery(adminQueries.events({ status: params.status, page: params.page }));
  const statusId = useId();

  return (
    <>
      <PageTitle title="Admin: events" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Events</h1>
        <Link to="/admin/events/new" className={PRIMARY_BUTTON_CLASS}>
          New event
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-1">
        <label htmlFor={statusId} className="font-medium text-slate-900">
          Status
        </label>
        <select
          id={statusId}
          value={params.status ?? ''}
          onChange={(event) => {
            const status = EventStatusSchema.safeParse(event.target.value).data;
            setSearchParams(new URLSearchParams(toSearch({ status, page: 1 })));
          }}
          className="w-56 rounded-md border border-slate-400 bg-white px-3 py-2 text-slate-900"
        >
          <option value="">All statuses</option>
          {EVENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <section aria-labelledby="admin-events-heading" className="mt-8">
        <h2 id="admin-events-heading" className="sr-only">
          Event list
        </h2>
        {events.isPending ? (
          <p role="status" className="text-slate-600">
            Loading events…
          </p>
        ) : events.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-red-900">
            <p className="font-medium">We couldn’t load the events. {errorMessage(events.error)}</p>
            <button type="button" onClick={() => void events.refetch()} className={LINK_CLASS}>
              Try again
            </button>
          </div>
        ) : events.data.items.length === 0 ? (
          <p className="text-slate-700">
            {events.data.total > 0
              ? 'There’s nothing on this page.'
              : params.status === undefined
                ? 'No events yet. Create the first one.'
                : `No ${STATUS_LABELS[params.status].toLowerCase()} events.`}
          </p>
        ) : (
          <>
            <EventTable events={events.data.items} />
            <Pagination
              page={params.page}
              totalPages={events.data.totalPages}
              hrefFor={(page) => `/admin/events${toSearch({ ...params, page })}`}
            />
          </>
        )}
      </section>
    </>
  );
}

function EventTable({ events }: { events: AdminEventSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse">
        <caption className="sr-only">Events, by start time</caption>
        <thead className="border-b border-slate-300 text-sm text-slate-600">
          <tr>
            <th scope="col" className={TABLE_CELL}>
              Event
            </th>
            <th scope="col" className={TABLE_CELL}>
              Starts
            </th>
            <th scope="col" className={TABLE_CELL}>
              Venue
            </th>
            <th scope="col" className={TABLE_CELL}>
              Status
            </th>
            <th scope="col" className={`${TABLE_CELL} text-right`}>
              Sold / released
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-slate-200">
              <th scope="row" className={`${TABLE_CELL} font-normal`}>
                <Link to={`/admin/events/${event.id}`} className={LINK_CLASS}>
                  {event.title}
                </Link>
                <span className="block text-sm text-slate-600">{event.performer}</span>
              </th>
              <td className={TABLE_CELL}>
                {formatEventDateTime(event.startsAt, event.venue.timezone)}
              </td>
              <td className={TABLE_CELL}>
                {event.venue.name}
                <span className="block text-sm text-slate-600">{event.venue.city}</span>
              </td>
              <td className={TABLE_CELL}>
                <StatusBadge status={event.status} />
              </td>
              <td className={`${TABLE_CELL} text-right tabular-nums`}>
                {event.tickets.sold.toLocaleString(LOCALE)} /{' '}
                {event.tickets.total.toLocaleString(LOCALE)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
