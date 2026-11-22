import { toNestErrors } from '@hookform/resolvers';
import type { FieldError, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/** Field path → message, e.g. `{ price: 'Enter a price in dollars' }`. */
export type FormatErrors = Record<string, string>;

export interface Conversion {
  /** The API request built from the form values; values that didn't convert are left out. */
  request: unknown;
  /** Values that couldn't be converted (a malformed price, a time the clocks skip). */
  errors: FormatErrors;
}

/** Where errors that belong to no field go: shown at the top of the form. */
export const FORM_ERROR_PATH = 'root.schema';

/**
 * A React Hook Form resolver for a form whose values are not the API request as they are (text for
 * numbers, dollars for cents, wall-clock times for instants): `convert` builds the request, and the
 * shared request schema validates it, so the form and the API apply the same rules and messages.
 * Conversion errors take the place of schema errors on the same field. Errors on paths that are not
 * form fields go to `root.schema`, unless a conversion failed.
 */
export function requestResolver<Values extends FieldValues, Request>(
  schema: z.ZodType<Request>,
  convert: (values: Values) => Conversion,
): Resolver<Values, unknown, Request> {
  return (values, _context, options) => {
    const { request, errors: formatErrors } = convert(values);
    const result = schema.safeParse(request);
    const names = options.names ?? Object.keys(options.fields);
    const isField = (path: string) =>
      names.some((name) => name === path || name.startsWith(`${path}.`));

    const errors: Record<string, FieldError> = {};
    const add = (path: string, error: FieldError, replace: boolean) => {
      const key = path !== '' && isField(path) ? path : FORM_ERROR_PATH;
      if (replace || !(key in errors)) errors[key] = error;
    };
    const hasFormatErrors = Object.keys(formatErrors).length > 0;
    for (const issue of result.error?.issues ?? []) {
      const path = issue.path.join('.');
      // A value that didn't convert is left out of the request, which can break a rule about the
      // whole request ("release at least one section"); the conversion error explains it.
      if (hasFormatErrors && (path === '' || !isField(path))) continue;
      add(path, { type: issue.code, message: issue.message }, false);
    }
    for (const [path, message] of Object.entries(formatErrors)) {
      add(path, { type: 'format', message }, true);
    }

    if (result.success && Object.keys(errors).length === 0) {
      return { values: result.data, errors: {} };
    }
    return { values: {}, errors: toNestErrors(errors, options) };
  };
}

/**
 * A whole number typed into a text field: `undefined` when empty, `NaN` when it isn't plain digits
 * (so "1.5", "1e3" and "0x10" fail the schema's whole-number check rather than being reinterpreted).
 */
export function parseIntegerInput(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Text typed into an optional text field: `undefined` when empty. */
export function optionalText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}
