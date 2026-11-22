import { describe, expect, it, vi } from 'vitest';

import { ProblemException } from '../errors/problem.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { insertWithSlug, nextFreeSlug } from './slugs.js';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('nextFreeSlug', () => {
  it('uses the base when it is free', () => {
    expect(nextFreeSlug('gig', new Set(['gig-2']))).toBe('gig');
  });

  it('adds the first free number', () => {
    expect(nextFreeSlug('gig', new Set(['gig', 'gig-2', 'gig-4']))).toBe('gig-3');
  });
});

describe('insertWithSlug', () => {
  it('inserts with the given slug and maps a conflict to slug-taken', async () => {
    const insert = vi.fn().mockRejectedValue(uniqueViolation());
    const result = insertWithSlug({
      slug: 'taken',
      base: 'ignored',
      takenLike: () => Promise.resolve([]),
      insert,
    });
    await expect(result).rejects.toMatchObject({
      code: 'SLUG_TAKEN',
      fieldErrors: [{ path: 'slug' }],
    });
    await expect(result).rejects.toBeInstanceOf(ProblemException);
    expect(insert).toHaveBeenCalledWith('taken');
  });

  it('retries a generated slug that a concurrent insert took', async () => {
    const taken = [['gig'], ['gig', 'gig-2']];
    const insert = vi
      .fn<(slug: string) => Promise<string>>()
      .mockRejectedValueOnce(uniqueViolation())
      .mockImplementation((slug) => Promise.resolve(slug));
    const slug = await insertWithSlug({
      slug: undefined,
      base: 'gig',
      takenLike: () => Promise.resolve(taken.shift() ?? []),
      insert,
    });
    expect(insert.mock.calls).toEqual([['gig-2'], ['gig-3']]);
    expect(slug).toBe('gig-3');
  });

  it('passes other errors through', async () => {
    const error = new Error('boom');
    await expect(
      insertWithSlug({
        slug: undefined,
        base: 'gig',
        takenLike: () => Promise.resolve([]),
        insert: () => Promise.reject(error),
      }),
    ).rejects.toBe(error);
  });
});
