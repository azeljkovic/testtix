import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { verifyEmail } from '../api/auth.js';
import { ApiError } from '../api/errors.js';
import { authPagePath } from '../auth/redirect.js';
import { ResendVerification } from '../auth/ResendVerification.js';
import { SESSION_QUERY_KEY, useSession } from '../auth/session.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

/** Landing page of the link in the verification email: `/verify-email?token=…`. */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const queryClient = useQueryClient();

  // A query rather than a mutation: verifying is idempotent, and the query runs once per token even
  // when React mounts the page twice (StrictMode) and keeps the result while the page is open.
  const verification = useQuery({
    queryKey: ['verify-email', token],
    queryFn: async () => {
      await verifyEmail(token);
      // The logged-in user (if it's theirs) is now verified.
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      return true;
    },
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (token === '') {
    return (
      <Result title="Verification link incomplete">
        <p>
          This link is missing its code. Open the link from the verification email again, or copy
          the whole address into your browser.
        </p>
        <GetNewLink />
      </Result>
    );
  }
  if (verification.isPending) {
    return (
      <>
        <PageTitle title="Verifying your email" />
        <p role="status">Verifying your email address…</p>
      </>
    );
  }
  if (verification.isSuccess) {
    return (
      <Result title="Email verified">
        <p>Thanks, your email address is verified. You can now buy tickets.</p>
        <Link to="/events" className={LINK_CLASS}>
          Browse events
        </Link>
      </Result>
    );
  }

  const { error } = verification;
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === 'VERIFICATION_TOKEN_EXPIRED') {
    return (
      <Result title="Verification link expired">
        <p>This verification link has expired.</p>
        <GetNewLink />
      </Result>
    );
  }
  if (code === 'VERIFICATION_TOKEN_INVALID' || code === 'VALIDATION_ERROR') {
    return (
      <Result title="Verification link not valid">
        <p>
          This link is incorrect, or a newer verification email has replaced it. Use the link in the
          latest email.
        </p>
        <GetNewLink />
      </Result>
    );
  }
  return (
    <Result title="We couldn’t verify your email">
      <p role="alert">{errorMessage(error)}</p>
      <button type="button" onClick={() => void verification.refetch()} className={LINK_CLASS}>
        Try again
      </button>
    </Result>
  );
}

function Result({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4 text-slate-700">
      <PageTitle title={title} />
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      {children}
    </div>
  );
}

/** How to get a working link: resend for the logged-in user, log in first otherwise. */
function GetNewLink() {
  const { data: session } = useSession();
  if (session === undefined) return null;
  if (session === null) {
    return (
      <p>
        <Link to={authPagePath('/login', '/account')} className={LINK_CLASS}>
          Log in
        </Link>{' '}
        to get a new verification email.
      </p>
    );
  }
  if (session.user.emailVerified) {
    return <p>Your email address is already verified, so there’s nothing more to do.</p>;
  }
  return <ResendVerification email={session.user.email} />;
}
