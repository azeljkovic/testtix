import { Link } from 'react-aria-components';

import { PageTitle } from '../layout/PageTitle.js';

export function NotFoundPage() {
  return (
    <>
      <PageTitle title="Page not found" />
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-4 text-slate-600">
        The page you were looking for doesn’t exist or has moved.
      </p>
      {/* A React Aria link, routed through React Router by the provider in RootLayout. */}
      <Link
        href="/"
        className="mt-6 inline-block font-medium text-indigo-700 underline underline-offset-4"
      >
        Go to the home page
      </Link>
    </>
  );
}
