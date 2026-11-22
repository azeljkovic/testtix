import { ApiError } from '../api/errors.js';
import { FormAlert } from '../forms/FormAlert.js';
import { errorMessage } from '../forms/form-errors.js';
import { useRefreshSession, useResendVerificationEmail } from './session.js';

function resendErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return 'We couldn’t send the email right now. Please try again in a few minutes.';
  }
  return errorMessage(error, { EMAIL_ALREADY_VERIFIED: 'Your email address is already verified.' });
}

/** "Send a new verification email" for the logged-in user, with the outcome announced. */
export function ResendVerification({ email }: { email: string }) {
  const resend = useResendVerificationEmail();
  const refreshSession = useRefreshSession();

  return (
    <div className="flex flex-col items-start gap-3">
      {/* Not React Aria's `isPending`, for the reason given in SubmitButton. */}
      <button
        type="button"
        aria-disabled={resend.isPending || undefined}
        onClick={() => {
          if (resend.isPending) return;
          resend.mutate(undefined, {
            onError: (error) => {
              // The address was verified elsewhere (e.g. in another tab): pick that up.
              if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_VERIFIED') {
                void refreshSession();
              }
            },
          });
        }}
        className="rounded-md border border-indigo-700 px-4 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        Send a new verification email
      </button>
      {/* Always rendered, so screen readers announce the message when it appears. */}
      <p role="status" className="text-sm text-slate-700">
        {resend.isSuccess &&
          `We sent a new link to ${email}. Links in earlier emails no longer work.`}
      </p>
      {resend.isError && <FormAlert>{resendErrorMessage(resend.error)}</FormAlert>}
    </div>
  );
}
