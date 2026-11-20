import {
  type ErrorCode,
  errorCodeOf,
  type ProblemDetails,
  ProblemDetailsSchema,
} from '@testtix/shared';

/** A non-2xx API response. Carries the problem details when the body is one, as API errors are. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  /** The parsed `application/problem+json` body, or `undefined` if the body isn't one (e.g. a proxy error page). */
  readonly problem: ProblemDetails | undefined;
  /** The error code of the problem `type`, for errors that have one. Branch on this, not on `detail`. */
  readonly code: ErrorCode | undefined;

  constructor(response: Response, body: unknown) {
    const parsed = ProblemDetailsSchema.safeParse(body);
    const problem = parsed.success ? parsed.data : undefined;
    super(problem?.detail ?? `The API returned ${response.status} ${response.statusText}`.trim());
    this.status = response.status;
    this.problem = problem;
    this.code = problem === undefined ? undefined : errorCodeOf(problem.type);
  }
}

/** The result shape of every `api.GET(…)` / `api.POST(…)` call. */
interface FetchResult<Data> {
  data?: Data;
  error?: unknown;
  response: Response;
}

/** Returns the data of a successful API call, or throws `ApiError` for a non-2xx response. */
export function unwrap<Data>({ data, error, response }: FetchResult<Data>): Data {
  if (!response.ok) throw new ApiError(response, error);
  return data as Data;
}
