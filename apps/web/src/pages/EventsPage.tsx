import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router';

import { EventCard } from '../catalogue/EventCard.js';
import { EventFilters } from '../catalogue/EventFilters.js';
import {
  dateRangeError,
  DEFAULT_LIST_PARAMS,
  type EventListParams,
  hasFilters,
  parseListParams,
  toApiQuery,
  toSearchParams,
} from '../catalogue/list-params.js';
import { Pagination } from '../catalogue/Pagination.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';
const SKELETON_CARDS = 6;

/** The public event list: search, filters, sort and pages, all kept in the URL query. */
export function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseListParams(searchParams);
  const listSearch = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
  const rangeError = dateRangeError(params);
  const events = useQuery({
    ...catalogueQueries.events(toApiQuery(params)),
    enabled: rangeError === undefined,
  });
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  // Each change is a history entry, so the back button undoes it.
  const update = (next: EventListParams) => {
    setSearchParams(toSearchParams(next));
  };
  const hrefFor = (page: number) => {
    const search = toSearchParams({ ...params, page }).toString();
    return search === '' ? '/events' : `/events?${search}`;
  };

  return (
    <>
      <PageTitle title="Events" />
      <h1 className="text-3xl font-bold tracking-tight">Events</h1>
      <div className="mt-6">
        <EventFilters
          params={params}
          onChange={(patch) => {
            update({ ...params, ...patch, page: 1 });
          }}
          onClear={() => {
            update({ ...DEFAULT_LIST_PARAMS, sort: params.sort, order: params.order });
          }}
        />
      </div>

      <section aria-labelledby="results-heading" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="results-heading"
            ref={resultsHeading}
            tabIndex={-1}
            className="text-xl font-semibold focus:outline-none"
          >
            Results
          </h2>
          <p role="status" className="text-slate-600">
            {rangeError !== undefined
              ? 'Fix the dates to see events.'
              : events.isPending
                ? 'Loading events…'
                : events.isError
                  ? ''
                  : summary(
                      events.data.page,
                      events.data.pageSize,
                      events.data.items.length,
                      events.data.total,
                    )}
          </p>
        </div>

        {rangeError !== undefined ? null : events.isPending ? (
          <EventListSkeleton />
        ) : events.isError ? (
          <div
            role="alert"
            className="mt-4 flex flex-col items-start gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-red-900"
          >
            <p className="font-medium">We couldn’t load the events. {errorMessage(events.error)}</p>
            <button type="button" onClick={() => void events.refetch()} className={LINK_CLASS}>
              Try again
            </button>
          </div>
        ) : events.data.items.length === 0 ? (
          events.data.total > 0 ? (
            <div className="mt-4 flex flex-col items-start gap-2 text-slate-700">
              <p>
                There’s no page {params.page}: these results have{' '}
                {events.data.totalPages === 1
                  ? '1 page'
                  : `${String(events.data.totalPages)} pages`}
                .
              </p>
              <Link to={hrefFor(events.data.totalPages)} className={LINK_CLASS}>
                Go to the last page
              </Link>
            </div>
          ) : hasFilters(params) ? (
            <div className="mt-4 flex flex-col items-start gap-2 text-slate-700">
              <p>No events match your search and filters.</p>
              <p>Try other filters, or clear them to see every event.</p>
            </div>
          ) : (
            <p className="mt-4 text-slate-700">No events are on sale yet. Check back soon.</p>
          )
        ) : (
          <>
            <ul aria-labelledby="results-heading" className="mt-4 grid gap-4 sm:grid-cols-2">
              {events.data.items.map((event) => (
                <li key={event.id}>
                  <EventCard event={event} listSearch={listSearch} />
                </li>
              ))}
            </ul>
            <Pagination
              page={params.page}
              totalPages={events.data.totalPages}
              hrefFor={hrefFor}
              onNavigate={() => resultsHeading.current?.focus()}
            />
          </>
        )}
      </section>
    </>
  );
}

/** "Showing 21–40 of 41 events". */
function summary(page: number, pageSize: number, count: number, total: number): string {
  if (total === 0) return 'No events found';
  if (count === 0) return `${String(total)} ${total === 1 ? 'event' : 'events'}`;
  const first = (page - 1) * pageSize + 1;
  return `Showing ${String(first)}–${String(first + count - 1)} of ${String(total)} ${total === 1 ? 'event' : 'events'}`;
}

/** Placeholder cards while the first results load. Hidden from screen readers (the status says it). */
function EventListSkeleton() {
  return (
    <ul aria-hidden="true" className="mt-4 grid gap-4 sm:grid-cols-2">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <li
          key={index}
          className="flex animate-pulse flex-col gap-3 rounded-lg border border-slate-200 p-5 motion-reduce:animate-none"
        >
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-6 w-3/4 rounded bg-slate-200" />
          <div className="h-4 w-1/2 rounded bg-slate-200" />
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="mt-2 h-5 w-1/4 rounded bg-slate-200" />
        </li>
      ))}
    </ul>
  );
}
