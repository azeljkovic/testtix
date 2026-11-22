import { ConflictException } from '@nestjs/common';

import { ProblemException } from '../errors/problem.exception.js';
import { isUniqueViolation } from './prisma-errors.js';

/** How often a generated slug is retried when a concurrent insert takes it first. */
const GENERATED_SLUG_ATTEMPTS = 5;

export function slugTaken(slug: string): ProblemException {
  return new ProblemException('SLUG_TAKEN', 409, 'Slug taken', `The slug "${slug}" is taken.`, [
    { path: 'slug', code: 'slug_taken', message: 'This slug is already in use' },
  ]);
}

/** `base` if it is free, else `base-2`, `base-3`, … (the first free one). */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface InsertWithSlugOptions<T> {
  /** The slug the client asked for. Taken → 409 `slug-taken`. */
  slug: string | undefined;
  /** Without `slug`: the generated slug to start from (`slugify(title)`). */
  base: string;
  /** Slugs in use that equal `base` or start with `base-`. */
  takenLike: (base: string) => Promise<string[]>;
  /**
   * Inserts the row with this slug. The only unique constraint its insert can break must be the
   * slug's, since a unique violation is read as "slug taken".
   */
  insert: (slug: string) => Promise<T>;
}

/**
 * Inserts a row with a unique slug: the client's (409 when taken), or the first free one of
 * `base`, `base-2`, … Generated slugs are retried when a concurrent insert takes the same one.
 */
export async function insertWithSlug<T>(options: InsertWithSlugOptions<T>): Promise<T> {
  if (options.slug !== undefined) {
    try {
      return await options.insert(options.slug);
    } catch (err) {
      if (isUniqueViolation(err)) throw slugTaken(options.slug);
      throw err;
    }
  }
  for (let attempt = 1; attempt <= GENERATED_SLUG_ATTEMPTS; attempt++) {
    const slug = nextFreeSlug(options.base, new Set(await options.takenLike(options.base)));
    try {
      return await options.insert(slug);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ConflictException('Could not find a free slug; try again or send one.');
}
