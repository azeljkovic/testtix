import { Injectable } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { deleteHold, lockHoldUnits, lockUserEvent } from './hold-locks.js';

/** Expired holds read per query. Each one is then released in its own short transaction. */
const PAGE_SIZE = 200;

export interface SweepResult {
  /** Expired holds deleted. */
  holds: number;
  /** Inventory units they still had, now `AVAILABLE`. */
  units: number;
}

interface ExpiredHold {
  id: string;
  eventId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Deletes expired holds and frees the units they still have (C3.2). Cleanup only: everything that
 * reads or claims inventory already treats `heldUntil <= now` as available, so whether and when
 * this runs never changes what customers see or can buy. It keeps the tables small and the
 * `HELD` status honest for people looking at the data.
 *
 * Each hold is released in its own transaction that takes the same locks as `HoldsService`, in the
 * same order (event share lock, the user's advisory lock, the hold's units by ID), so a sweep can
 * run alongside customers holding, replacing and releasing without deadlocks or lost updates.
 */
@Injectable()
export class HoldSweeperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** Releases every hold that has expired by now (server clock). */
  async sweep(): Promise<SweepResult> {
    const now = await this.clock.now();
    const result: SweepResult = { holds: 0, units: 0 };
    let after: ExpiredHold | undefined;
    for (;;) {
      // Keyset pagination, so a hold that can't be deleted is never read twice.
      const page: ExpiredHold[] = await this.prisma.hold.findMany({
        where: {
          expiresAt: { lte: now },
          ...(after === undefined
            ? {}
            : {
                OR: [
                  { expiresAt: { gt: after.expiresAt } },
                  { expiresAt: after.expiresAt, id: { gt: after.id } },
                ],
              }),
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: PAGE_SIZE,
        select: { id: true, eventId: true, userId: true, expiresAt: true },
      });
      for (const hold of page) {
        const released = await this.releaseExpired(hold);
        result.holds += released.holds;
        result.units += released.units;
      }
      if (page.length < PAGE_SIZE) return result;
      after = page.at(-1);
    }
  }

  private async releaseExpired(hold: ExpiredHold): Promise<SweepResult> {
    return this.prisma.$transaction(async (tx) => {
      // Any status: a cancelled or unpublished event's expired holds are cleaned up too.
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${hold.eventId}::uuid FOR SHARE`;
      await lockUserEvent(tx, hold.userId, hold.eventId);
      await lockHoldUnits(tx, hold.id);
      // No expiry re-check: a hold's `expiresAt` never changes (a new hold gets a new ID), so the
      // hold is either still expired or already gone. Units another customer has claimed since it
      // expired already point at their hold, so only the units still on this hold are released.
      return deleteHold(tx, hold.id);
    });
  }
}
