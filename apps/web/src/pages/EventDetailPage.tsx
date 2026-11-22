import { useQuery } from '@tanstack/react-query';
import { LOCALE } from '@testtix/shared';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import type { CatalogueEvent } from '../api/catalogue.js';
import { ApiError } from '../api/errors.js';
import { AvailabilityBadge, type EventLinkState } from '../catalogue/EventCard.js';
import {
  CATEGORY_LABELS,
  formatEventDateTime,
  formatEventTimeRange,
  formatPriceRange,
  NOT_ON_SALE_NOTES,
  SEATING_LABELS,
  SECTION_TYPE_LABELS,
  ticketCount,
} from '../catalogue/format.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

/** One published event: when and where, prices, ticket availability per section. */
export function EventDetailPage() {
  const { slug = '' } = useParams();
  const event = useQuery(catalogueQueries.event(slug));

  if (event.isPending) {
    return (
      <>
        <PageTitle title="Loading event" />
        <BackLink />
        <p role="status" className="mt-6 text-slate-600">
          Loading event…
        </p>
        <DetailSkeleton />
      </>
    );
  }
  if (event.isError) {
    if (event.error instanceof ApiError && event.error.status === 404) {
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
    return (
      <>
        <PageTitle title="Event unavailable" />
        <BackLink />
        <h1 className="mt-6 text-3xl font-bold tracking-tight">We couldn’t load this event</h1>
        <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
          <p>{errorMessage(event.error)}</p>
          <button type="button" onClick={() => void event.refetch()} className={LINK_CLASS}>
            Try again
          </button>
        </div>
      </>
    );
  }

  return <EventDetails event={event.data} />;
}

function EventDetails({ event }: { event: CatalogueEvent }) {
  const { timezone } = event.venue;

  return (
    <>
      <PageTitle title={event.title} />
      <BackLink />
      <article aria-labelledby="event-title" className="mt-6">
        <p className="text-sm font-medium tracking-wide text-indigo-700 uppercase">
          {CATEGORY_LABELS[event.category]} · {SEATING_LABELS[event.seating]}
        </p>
        <h1 id="event-title" className="mt-1 text-3xl font-bold tracking-tight">
          {event.title}
        </h1>
        <p className="mt-2 text-lg text-slate-700">{event.performer}</p>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_20rem]">
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-3">
            <Detail term="When">
              <time dateTime={event.startsAt}>
                {formatEventTimeRange(event.startsAt, event.endsAt, timezone)}
              </time>
            </Detail>
            <Detail term="Where">
              {event.venue.name}
              <br />
              {event.venue.address}, {event.venue.city}
            </Detail>
            <Detail term="Prices">{formatPriceRange(event.priceRange)}</Detail>
            <Detail term="Sales open">
              <time dateTime={event.salesOpenAt}>
                {formatEventDateTime(event.salesOpenAt, timezone)}
              </time>
            </Detail>
            <Detail term="Per order">Up to {ticketCount(event.maxTicketsPerOrder)}</Detail>
          </dl>
          <TicketsCallToAction event={event} />
        </div>

        <section aria-labelledby="about-heading" className="mt-10">
          <h2 id="about-heading" className="text-xl font-semibold">
            About this event
          </h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-slate-700">{event.description}</p>
        </section>

        <AvailabilityTable event={event} />
      </article>
    </>
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

/** The earliest scheduled release across sections, if any. */
function nextRelease(event: CatalogueEvent): string | undefined {
  const dates = event.sections.flatMap((section) =>
    section.nextReleaseAt === null ? [] : [section.nextReleaseAt],
  );
  return dates.sort()[0];
}

/** The sales state, and the way to buy while the event is on sale. */
function TicketsCallToAction({ event }: { event: CatalogueEvent }) {
  const release = nextRelease(event);
  const releaseNote = release !== undefined && (
    <p>
      {event.tickets.total === 0 ? 'Tickets are' : 'More tickets are'} released{' '}
      <time dateTime={release}>{formatEventDateTime(release, event.venue.timezone)}</time>.
    </p>
  );

  const content = (() => {
    switch (event.availability) {
      case 'ON_SALE':
        return (
          <>
            <p>{ticketCount(event.availableTickets)} available.</p>
            <Link
              to={`/events/${event.slug}/seats`}
              className="mt-1 inline-block rounded-md bg-indigo-700 px-5 py-3 text-center font-semibold text-white hover:bg-indigo-800"
            >
              {event.seating === 'GA' ? 'Choose tickets' : 'Choose seats'}
            </Link>
          </>
        );
      case 'SOLD_OUT':
        return (
          <>
            <p>{NOT_ON_SALE_NOTES.SOLD_OUT}</p>
            {releaseNote}
          </>
        );
      case 'SALES_NOT_OPEN':
        return (
          <>
            <p>{NOT_ON_SALE_NOTES.SALES_NOT_OPEN}</p>
            {releaseNote}
          </>
        );
      case 'SALES_ENDED':
        return <p>{NOT_ON_SALE_NOTES.SALES_ENDED}</p>;
    }
  })();

  return (
    <section
      aria-labelledby="tickets-heading"
      className="flex flex-col items-stretch gap-3 self-start rounded-lg border border-slate-200 bg-slate-50 p-5 text-slate-700"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="tickets-heading" className="text-lg font-semibold text-slate-900">
          Tickets
        </h2>
        <AvailabilityBadge availability={event.availability} />
      </div>
      {content}
    </section>
  );
}

const number = (value: number) => value.toLocaleString(LOCALE);
const CELL = 'px-3 py-2 text-left';
const NUMBER_CELL = 'px-3 py-2 text-right tabular-nums';

/** Released tickets per section: available, held and sold, with prices and the next release. */
function AvailabilityTable({ event }: { event: CatalogueEvent }) {
  return (
    <section aria-labelledby="availability-heading" className="mt-10">
      <h2 id="availability-heading" className="text-xl font-semibold">
        Ticket availability
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Released tickets only. Times are the venue’s local time.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table
          aria-labelledby="availability-heading"
          className="w-full min-w-[40rem] border-collapse"
        >
          <thead className="border-b border-slate-300 text-sm text-slate-600">
            <tr>
              <th scope="col" className={CELL}>
                Section
              </th>
              <th scope="col" className={CELL}>
                Type
              </th>
              <th scope="col" className={CELL}>
                Price
              </th>
              <th scope="col" className={NUMBER_CELL}>
                Available
              </th>
              <th scope="col" className={NUMBER_CELL}>
                Held
              </th>
              <th scope="col" className={NUMBER_CELL}>
                Sold
              </th>
              <th scope="col" className={CELL}>
                Next release
              </th>
            </tr>
          </thead>
          <tbody>
            {event.sections.map((section) => (
              <tr key={section.id} className="border-b border-slate-200">
                <th scope="row" className={`${CELL} font-medium`}>
                  {section.name}
                </th>
                <td className={CELL}>{SECTION_TYPE_LABELS[section.type]}</td>
                <td className={CELL}>{formatPriceRange(section.priceRange)}</td>
                <td className={NUMBER_CELL}>{number(section.tickets.available)}</td>
                <td className={NUMBER_CELL}>{number(section.tickets.held)}</td>
                <td className={NUMBER_CELL}>{number(section.tickets.sold)}</td>
                <td className={CELL}>
                  {section.nextReleaseAt === null ? (
                    'None'
                  ) : (
                    <time dateTime={section.nextReleaseAt}>
                      {formatEventDateTime(section.nextReleaseAt, event.venue.timezone)}
                    </time>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <th scope="row" className={CELL}>
                All sections
              </th>
              <td className={CELL}>{SEATING_LABELS[event.seating]}</td>
              <td className={CELL}>{formatPriceRange(event.priceRange)}</td>
              <td className={NUMBER_CELL}>{number(event.tickets.available)}</td>
              <td className={NUMBER_CELL}>{number(event.tickets.held)}</td>
              <td className={NUMBER_CELL}>{number(event.tickets.sold)}</td>
              <td className={CELL} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Back to the list, with the search and filters the visitor came from. */
function BackLink() {
  const { state } = useLocation() as { state: Partial<EventLinkState> | null };
  const listSearch = typeof state?.listSearch === 'string' ? state.listSearch : '';
  return (
    <Link to={`/events${listSearch.startsWith('?') ? listSearch : ''}`} className={LINK_CLASS}>
      ‹ Back to events
    </Link>
  );
}

/** Grey blocks in the shape of the page while it loads. */
function DetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 flex animate-pulse flex-col gap-4 motion-reduce:animate-none"
    >
      <div className="h-4 w-40 rounded bg-slate-200" />
      <div className="h-9 w-2/3 rounded bg-slate-200" />
      <div className="h-5 w-1/3 rounded bg-slate-200" />
      <div className="mt-6 h-32 w-full rounded bg-slate-200" />
      <div className="h-48 w-full rounded bg-slate-200" />
    </div>
  );
}
