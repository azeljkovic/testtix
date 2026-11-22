import { ResendVerification } from '../auth/ResendVerification.js';
import { useSession } from '../auth/session.js';
import { PageTitle } from '../layout/PageTitle.js';

const ROLE_LABELS = { CUSTOMER: 'Customer', ADMIN: 'Admin' } as const;

/** The logged-in user's details. Behind `RequireAuth`, so the session is loaded. */
export function AccountPage() {
  const { data: session } = useSession();
  if (!session) return null;
  const { user } = session;

  return (
    <>
      <PageTitle title="Your account" />
      <h1 className="text-3xl font-bold tracking-tight">Your account</h1>
      {!user.emailVerified && (
        <section
          aria-labelledby="verify-email-heading"
          className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4"
        >
          <h2 id="verify-email-heading" className="text-lg font-semibold">
            Verify your email address
          </h2>
          <p className="mt-1 mb-4 text-slate-700">
            We sent a verification link to {user.email}. You need to verify your address before you
            can check out.
          </p>
          <ResendVerification email={user.email} />
        </section>
      )}
      <dl className="mt-8 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        <dt className="font-medium text-slate-600">Name</dt>
        <dd>{user.name}</dd>
        <dt className="font-medium text-slate-600">Email</dt>
        <dd>{user.email}</dd>
        <dt className="font-medium text-slate-600">Email status</dt>
        <dd>{user.emailVerified ? 'Verified' : 'Not verified'}</dd>
        <dt className="font-medium text-slate-600">Account type</dt>
        <dd>{ROLE_LABELS[user.role]}</dd>
      </dl>
    </>
  );
}
