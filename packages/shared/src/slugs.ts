import { z } from 'zod';

export const SLUG_MAX_LENGTH = 100;

/** Lower-case letters and digits in groups separated by single hyphens, e.g. `riverside-hall-2`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Leaves room for a `-<n>` suffix within `SLUG_MAX_LENGTH`, added when a generated slug is taken.
 */
const SLUGIFY_MAX_LENGTH = SLUG_MAX_LENGTH - 10;

export const SlugSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter a slug' })
  .max(SLUG_MAX_LENGTH, { error: `Slug must be at most ${SLUG_MAX_LENGTH} characters` })
  .regex(SLUG_PATTERN, {
    error: 'Use lower-case letters and digits, separated by single hyphens',
  })
  .describe(
    `URL name: lower-case letters and digits separated by single hyphens, at most ${SLUG_MAX_LENGTH} characters. Unique.`,
  );

/**
 * Turns a title into a slug: accents removed, lower case, every run of other characters replaced
 * by one hyphen, at most 90 characters. Returns `fallback` when nothing is left (e.g. a title of
 * only emoji).
 */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUGIFY_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? fallback : slug;
}
