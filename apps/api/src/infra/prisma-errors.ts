import { Prisma } from '../generated/prisma/client.js';

/**
 * A unique constraint rejected the write (P2002). Catch it instead of checking first: the index
 * decides, so two concurrent writers can't both win.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** A foreign key rejected the write (P2003), e.g. the referenced row was deleted meanwhile. */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}
