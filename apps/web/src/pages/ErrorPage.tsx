import { useEffect } from 'react';
import { Link, useRouteError } from 'react-router';

import { browserLocation } from '../app/browser-location.js';
import { PageTitle } from '../layout/PageTitle.js';

/**
 * The route error boundary (`errorElement` in `routes.tsx`): a page that failed to render. It keeps
 * the site header and footer, says what to do next and leaves the details to the console, never the
 * page (they're for developers and could be anything).
 */
export function ErrorPage() {
  const error = useRouteError();

  useEffect(() => {
    // The console is the one place the details go: there's no error reporting service.
    // eslint-disable-next-line no-console
    console.error('The page failed to render', error);
  }, [error]);

  return (
    <>
      <PageTitle title="Something went wrong" />
      <h1 className="text-3xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-4 text-slate-600">
        This page couldn’t be shown. Reload it to try again; if that doesn’t help, start over from
        the home page.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-6">
        <button
          type="button"
          onClick={() => {
            browserLocation.reload();
          }}
          className="rounded-md bg-indigo-700 px-5 py-2.5 font-semibold text-white hover:bg-indigo-800"
        >
          Reload the page
        </button>
        {/* A full page load: whatever broke may live in the app's in-memory state. */}
        <Link
          to="/"
          reloadDocument
          className="font-medium text-indigo-700 underline underline-offset-4"
        >
          Go to the home page
        </Link>
      </div>
    </>
  );
}
