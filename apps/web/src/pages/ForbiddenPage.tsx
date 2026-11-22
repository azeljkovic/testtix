import { Link } from 'react-router';

import { PageTitle } from '../layout/PageTitle.js';

/** Shown in place of a page the logged-in user's role doesn't allow. */
export function ForbiddenPage() {
  return (
    <>
      <PageTitle title="Access denied" />
      <h1 className="text-3xl font-bold tracking-tight">Access denied</h1>
      <p className="mt-4 text-slate-600">Your account doesn’t have access to this page.</p>
      <Link
        to="/"
        className="mt-6 inline-block font-medium text-indigo-700 underline underline-offset-4"
      >
        Go to the home page
      </Link>
    </>
  );
}
