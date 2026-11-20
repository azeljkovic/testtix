import { Link } from 'react-router';

import { PageTitle } from '../layout/PageTitle.js';

export function HomePage() {
  return (
    <>
      <PageTitle />
      <h1 className="text-4xl font-bold tracking-tight">Tickets for concerts, talks and meetups</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        Pick your seats, hold them while you check out, and get your e-tickets by email.
      </p>
      <Link
        to="/events"
        className="mt-8 inline-block rounded-md bg-indigo-700 px-5 py-3 font-semibold text-white hover:bg-indigo-800"
      >
        Browse events
      </Link>
    </>
  );
}
