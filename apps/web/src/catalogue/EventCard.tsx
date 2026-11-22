import type { EventAvailability } from '@testtix/shared';
import { Link } from 'react-router';

import type { CatalogueEventSummary } from '../api/catalogue.js';
import {
  AVAILABILITY_LABELS,
  CATEGORY_LABELS,
  formatEventDateTime,
  formatPriceRange,
  SEATING_LABELS,
} from './format.js';

/** Router state of a link into an event page: the list query to go back to. */
export interface EventLinkState {
  listSearch: string;
}

const AVAILABILITY_CLASSES: Record<EventAvailability, string> = {
  ON_SALE: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  SOLD_OUT: 'border-red-300 bg-red-50 text-red-900',
  SALES_NOT_OPEN: 'border-amber-300 bg-amber-50 text-amber-900',
  SALES_ENDED: 'border-slate-300 bg-slate-100 text-slate-800',
};

/** The sales state as text (never colour alone). */
export function AvailabilityBadge({ availability }: { availability: EventAvailability }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium ${AVAILABILITY_CLASSES[availability]}`}
    >
      {AVAILABILITY_LABELS[availability]}
    </span>
  );
}

/** One event in the list. The title links to the event page; the whole card is clickable. */
export function EventCard({
  event,
  listSearch,
}: {
  event: CatalogueEventSummary;
  listSearch: string;
}) {
  const titleId = `event-${event.id}-title`;
  return (
    <article
      aria-labelledby={titleId}
      className="relative flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400"
    >
      <p className="text-sm font-medium tracking-wide text-indigo-700 uppercase">
        {CATEGORY_LABELS[event.category]} · {SEATING_LABELS[event.seating]}
      </p>
      <h3 id={titleId} className="text-xl font-semibold text-slate-900">
        <Link
          to={`/events/${event.slug}`}
          state={{ listSearch } satisfies EventLinkState}
          // The link's ::after covers the card, so a click anywhere opens the event.
          className="after:absolute after:inset-0 after:content-['']"
        >
          {event.title}
        </Link>
      </h3>
      <p className="text-slate-700">{event.performer}</p>
      <p className="text-slate-700">
        <time dateTime={event.startsAt}>
          {formatEventDateTime(event.startsAt, event.venue.timezone)}
        </time>
      </p>
      <p className="text-slate-700">
        {event.venue.name}, {event.venue.city}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
        <p className="font-semibold text-slate-900">{formatPriceRange(event.priceRange)}</p>
        <AvailabilityBadge availability={event.availability} />
      </div>
    </article>
  );
}
