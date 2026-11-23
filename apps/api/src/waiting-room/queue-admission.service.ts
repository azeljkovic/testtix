import { Injectable } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QueueStore } from './queue-store.js';

export interface AdmissionResult {
  eventId: string;
  admitted: number;
}

/**
 * Lets customers in from every waiting room with someone waiting (C5.1). It is the admission
 * job's body, and needs nothing but Redis, Postgres and the clock, so it runs in any worker
 * process. Safe to run concurrently: each event's step is one atomic Redis script.
 *
 * At most `admissionRatePerSec` customers per second of server time: with a frozen clock nobody
 * new goes in, and moving the clock forward lets in the batches that fell due. Nobody goes in
 * before `salesOpenAt`. An event whose waiting room was turned off, or that is no longer
 * published, lets everyone in at once (nothing checks admissions there any more).
 */
@Injectable()
export class QueueAdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly store: QueueStore,
  ) {}

  async admit(): Promise<AdmissionResult[]> {
    const eventIds = await this.store.activeEventIds();
    if (eventIds.length === 0) return [];
    const now = await this.clock.now();
    const events = await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        status: true,
        salesOpenAt: true,
        waitingRoomEnabled: true,
        admissionRatePerSec: true,
        admissionTokenTtlSec: true,
      },
    });
    const byId = new Map(events.map((event) => [event.id, event]));
    const results: AdmissionResult[] = [];
    for (const eventId of eventIds.sort()) {
      const event = byId.get(eventId);
      if (event === undefined) {
        await this.store.deactivate(eventId);
        continue;
      }
      const gated = event.waitingRoomEnabled && event.status === 'PUBLISHED';
      const admitted = await this.store.admit({
        eventId,
        now,
        opensAt: gated ? event.salesOpenAt : new Date(0),
        ratePerSec: gated ? event.admissionRatePerSec : 0,
        admissionTtlMs: event.admissionTokenTtlSec * 1000,
      });
      results.push({ eventId, admitted });
    }
    return results;
  }
}
