/**
 * One-line description of an error for log messages. Connection failures to `localhost` are an
 * `AggregateError` (one attempt per IP family) with an empty message, so fall back to its code.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message !== '') return err.message;
  const { code } = err as Error & { code?: unknown };
  return typeof code === 'string' ? code : err.name;
}
