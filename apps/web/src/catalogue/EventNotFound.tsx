import { Link } from 'react-router';

import { PageTitle } from '../layout/PageTitle.js';

/** The page for an event slug the catalogue doesn't know (or no longer shows). */
export function EventNotFound() {
  return (
    <>
      <PageTitle title="Event not found" />
      <h1 className="text-3xl font-bold tracking-tight">Event not found</h1>
      <p className="mt-4 text-slate-600">
        There’s no event at this address. It may have been unpublished or cancelled.
      </p>
      <Link
        to="/events"
        className="mt-6 inline-block font-medium text-indigo-700 underline underline-offset-4"
      >
        Browse all events
      </Link>
    </>
  );
}
