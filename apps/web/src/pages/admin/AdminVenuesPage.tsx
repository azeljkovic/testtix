import { useQuery } from '@tanstack/react-query';
import { LOCALE } from '@testtix/shared';
import { Link, useSearchParams } from 'react-router';

import {
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  sectionSummary,
  TABLE_CELL,
} from '../../admin/format.js';
import { adminQueries } from '../../admin/queries.js';
import type { AdminVenueSummary } from '../../api/admin.js';
import { Pagination } from '../../catalogue/Pagination.js';
import { errorMessage } from '../../forms/form-errors.js';
import { PageTitle } from '../../layout/PageTitle.js';

function pageParam(searchParams: URLSearchParams): number {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page > 1 ? page : 1;
}

/** Venues and their layouts, by name. */
export function AdminVenuesPage() {
  const [searchParams] = useSearchParams();
  const page = pageParam(searchParams);
  const venues = useQuery(adminQueries.venues({ page }));

  return (
    <>
      <PageTitle title="Admin: venues" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Venues</h1>
        <Link to="/admin/venues/new" className={PRIMARY_BUTTON_CLASS}>
          New venue
        </Link>
      </div>
      <div className="mt-8">
        {venues.isPending ? (
          <p role="status" className="text-slate-600">
            Loading venues…
          </p>
        ) : venues.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-red-900">
            <p className="font-medium">We couldn’t load the venues. {errorMessage(venues.error)}</p>
            <button type="button" onClick={() => void venues.refetch()} className={LINK_CLASS}>
              Try again
            </button>
          </div>
        ) : venues.data.items.length === 0 ? (
          <p className="text-slate-700">
            {venues.data.total > 0 ? 'There’s nothing on this page.' : 'No venues yet.'}
          </p>
        ) : (
          <>
            <VenueTable venues={venues.data.items} />
            <Pagination
              page={page}
              totalPages={venues.data.totalPages}
              hrefFor={(target) =>
                target === 1 ? '/admin/venues' : `/admin/venues?page=${String(target)}`
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function VenueTable({ venues }: { venues: AdminVenueSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse">
        <caption className="sr-only">Venues, by name</caption>
        <thead className="border-b border-slate-300 text-sm text-slate-600">
          <tr>
            <th scope="col" className={TABLE_CELL}>
              Venue
            </th>
            <th scope="col" className={TABLE_CELL}>
              Sections
            </th>
            <th scope="col" className={`${TABLE_CELL} text-right`}>
              Capacity
            </th>
            <th scope="col" className={TABLE_CELL}>
              Layout
            </th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <tr key={venue.id} className="border-b border-slate-200">
              <th scope="row" className={`${TABLE_CELL} font-normal`}>
                <Link to={`/admin/venues/${venue.id}`} className={LINK_CLASS}>
                  {venue.name}
                </Link>
                <span className="block text-sm text-slate-600">
                  {venue.city} · {venue.timezone}
                </span>
              </th>
              <td className={TABLE_CELL}>{sectionSummary(venue.sections)}</td>
              <td className={`${TABLE_CELL} text-right tabular-nums`}>
                {venue.capacity.toLocaleString(LOCALE)}
              </td>
              <td className={TABLE_CELL}>{venue.layoutLocked ? 'Locked' : 'Editable'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
