import { z } from 'zod';

// Field builders shared by the request schemas. The messages are shown next to form fields.

/** A trimmed, required string of at most `max` characters. */
export function requiredText(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, { error: `Enter the ${label.toLowerCase()}` })
    .max(max, { error: `${label} must be at most ${max} characters` });
}

/** A whole number in `[min, max]`. */
export function intBetween({ min, max }: { min: number; max: number }, label: string) {
  return z
    .number({ error: `${label} must be a whole number` })
    .int({ error: `${label} must be a whole number` })
    .min(min, { error: `${label} must be at least ${min}` })
    .max(max, { error: `${label} must be at most ${max}` });
}
