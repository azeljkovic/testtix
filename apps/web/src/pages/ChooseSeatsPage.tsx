import { Link, useParams } from 'react-router';

import { PageTitle } from '../layout/PageTitle.js';

/**
 * Where "Choose seats" leads. The seat map (C3.3) and holds (C3.4) replace this placeholder; until
 * then it says tickets can't be picked yet.
 */
export function ChooseSeatsPage() {
  const { slug = '' } = useParams();
  return (
    <>
      <PageTitle title="Choose seats" />
      <h1 className="text-3xl font-bold tracking-tight">Choose seats</h1>
      <p className="mt-4 text-slate-600">
        Picking seats and tickets isn’t available yet. It arrives with the seat map.
      </p>
      <Link
        to={`/events/${slug}`}
        className="mt-6 inline-block font-medium text-indigo-700 underline underline-offset-4"
      >
        Back to the event
      </Link>
    </>
  );
}
