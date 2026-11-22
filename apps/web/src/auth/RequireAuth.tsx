import type { Role } from '@testtix/shared';
import { Navigate, Outlet, useLocation } from 'react-router';

import { ForbiddenPage } from '../pages/ForbiddenPage.js';
import { authPagePath } from './redirect.js';
import { useSession } from './session.js';

/**
 * Route guard for a layout route: renders the child routes for a logged-in user (with `role`, if
 * given), sends anonymous visitors to the login page and back, and shows "access denied" for a user
 * without the role.
 */
export function RequireAuth({ role }: { role?: Role }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return <p role="status">Loading…</p>;
  }
  if (session.isError) {
    return (
      <div role="alert">
        <p>We couldn’t check whether you’re logged in.</p>
        <button
          type="button"
          onClick={() => void session.refetch()}
          className="mt-2 font-medium text-indigo-700 underline underline-offset-4"
        >
          Try again
        </button>
      </div>
    );
  }
  if (session.data === null) {
    return <Navigate to={authPagePath('/login', location)} replace />;
  }
  if (role !== undefined && session.data.user.role !== role) {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}
