import type { ErrorCode } from '@testtix/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from '../api/errors.js';

export const NETWORK_ERROR_MESSAGE =
  'We couldn’t reach TestTix. Check your connection and try again.';
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.';

/** Text to show for a failed API call. `messages` overrides it per error code. */
export function errorMessage(
  error: unknown,
  messages: Partial<Record<ErrorCode, string>> = {},
): string {
  if (!(error instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  const forCode = error.code === undefined ? undefined : messages[error.code];
  if (forCode !== undefined) return forCode;
  if (error.status >= 500 || error.problem === undefined) return SERVER_ERROR_MESSAGE;
  return error.problem.detail;
}

/**
 * Shows a failed submit in the form: field errors from the API go to their fields (focusing the
 * first), and anything else becomes the form-level `root.server` error.
 */
export function showSubmitError<Values extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<Values>,
  fields: readonly Path<Values>[],
  messages: Partial<Record<ErrorCode, string>> = {},
): void {
  const fieldErrors =
    error instanceof ApiError
      ? (error.problem?.errors ?? []).filter((fieldError) =>
          (fields as readonly string[]).includes(fieldError.path),
        )
      : [];
  if (fieldErrors.length === 0) {
    setError('root.server', { type: 'server', message: errorMessage(error, messages) });
    return;
  }
  fieldErrors.forEach((fieldError, index) => {
    setError(
      fieldError.path as Path<Values>,
      { type: 'server', message: fieldError.message },
      { shouldFocus: index === 0 },
    );
  });
}
