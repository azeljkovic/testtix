import { Link } from 'react-router';

import { LINK_CLASS } from '../../admin/format.js';
import { ApiError } from '../../api/errors.js';
import { errorMessage } from '../../forms/form-errors.js';
import { PageTitle } from '../../layout/PageTitle.js';

interface AdminNotFoundProps {
  what: 'event' | 'venue';
  /** The error of loading it: a 404 says it doesn't exist, anything else offers a retry. */
  error: Error;
  retry: () => void;
}

/** An admin page whose event or venue couldn't be loaded. */
export function AdminNotFound({ what, error, retry }: AdminNotFoundProps) {
  const listPath = what === 'event' ? '/admin/events' : '/admin/venues';
  if (error instanceof ApiError && error.status === 404) {
    const title = what === 'event' ? 'Event not found' : 'Venue not found';
    return (
      <>
        <PageTitle title={title} />
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-4 text-slate-600">It may have been deleted.</p>
        <Link to={listPath} className={`mt-6 inline-block ${LINK_CLASS}`}>
          Back to all {what}s
        </Link>
      </>
    );
  }
  const title = `We couldn’t load this ${what}`;
  return (
    <>
      <PageTitle title={title} />
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
        <p>{errorMessage(error)}</p>
        <button type="button" onClick={retry} className={LINK_CLASS}>
          Try again
        </button>
      </div>
    </>
  );
}
