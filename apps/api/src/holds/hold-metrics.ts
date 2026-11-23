import { Inject, Injectable, Logger } from '@nestjs/common';
import { Counter, Gauge, type Registry } from '@prometheus-io/client';

import { ClockService } from '../clock/clock.service.js';
import { ProblemException } from '../errors/problem.exception.js';
import { PrismaService } from '../infra/prisma.service.js';
import { describeError } from '../logging/describe-error.js';
import { METRICS_REGISTRY } from '../metrics/metrics.tokens.js';

/** `outcome` of `testtix_hold_requests_total`. */
export type HoldOutcome = 'created' | 'tickets_unavailable' | 'rejected';

/**
 * Hold metrics on `/metrics` (C6.2): hold requests per API process (Prometheus sums replicas),
 * and the tickets held right now per event, read from Postgres at scrape time (so every replica
 * reports the same numbers; without the database the gauge is left out).
 */
@Injectable()
export class HoldMetrics {
  private readonly logger = new Logger(HoldMetrics.name);
  private readonly requests: Counter<'outcome'>;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {
    this.requests = new Counter({
      name: 'testtix_hold_requests_total',
      help: 'Hold requests by outcome: created, tickets_unavailable (409, someone else has them) or rejected (any other error)',
      labelNames: ['outcome'],
      registers: [registry],
    });
    for (const outcome of ['created', 'tickets_unavailable', 'rejected'] as const) {
      this.requests.inc({ outcome }, 0);
    }
    const read = () => this.heldTickets();
    new Gauge({
      name: 'testtix_held_tickets',
      help: 'Tickets in unexpired holds, per event (events with none are left out)',
      labelNames: ['event_id'],
      registers: [registry],
      async collect() {
        const rows = await read();
        this.reset();
        for (const row of rows) this.set({ event_id: row.eventId }, row.count);
      },
    });
  }

  /** Counts a finished hold request: `error` is what it threw, if anything. */
  record(error?: unknown): void {
    this.requests.inc({ outcome: outcomeOf(error) });
  }

  private async heldTickets(): Promise<{ eventId: string; count: number }[]> {
    try {
      const now = await this.clock.now();
      const rows = await this.prisma.$queryRaw<{ event_id: string; count: bigint }[]>`
        SELECT event_id::text, count(*) AS count FROM inventory_units
        WHERE status = 'HELD' AND held_until > ${now}
        GROUP BY event_id`;
      return rows.map((r) => ({ eventId: r.event_id, count: Number(r.count) }));
    } catch (err) {
      this.logger.warn(`Could not read hold metrics: ${describeError(err)}`);
      return [];
    }
  }
}

function outcomeOf(error: unknown): HoldOutcome {
  if (error === undefined) return 'created';
  if (error instanceof ProblemException && error.code === 'TICKETS_UNAVAILABLE') {
    return 'tickets_unavailable';
  }
  return 'rejected';
}
