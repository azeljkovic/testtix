import { Inject, Injectable, Logger } from '@nestjs/common';
import { Gauge, type Registry } from '@prometheus-io/client';
import { ORDER_STATUSES, type OrderStatus } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { describeError } from '../logging/describe-error.js';
import { METRICS_REGISTRY } from '../metrics/metrics.tokens.js';

/**
 * Order metrics on `/metrics` (C6.2): every order by the status customers see (`effectiveStatus()`:
 * an unpaid order past its expiry counts as `EXPIRED`), read from Postgres at scrape time, so every
 * replica reports the same numbers. Without the database the gauge is left out.
 */
@Injectable()
export class OrderMetrics {
  private readonly logger = new Logger(OrderMetrics.name);

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {
    const read = () => this.counts();
    new Gauge({
      name: 'testtix_orders',
      help: 'Orders by status (an unpaid order past its expiry is EXPIRED)',
      labelNames: ['status'],
      registers: [registry],
      async collect() {
        const counts = await read();
        this.reset();
        if (counts === null) return;
        for (const status of ORDER_STATUSES) this.set({ status }, counts.get(status) ?? 0);
      },
    });
  }

  private async counts(): Promise<Map<OrderStatus, number> | null> {
    try {
      const now = await this.clock.now();
      const rows = await this.prisma.$queryRaw<{ status: OrderStatus; count: bigint }[]>`
        SELECT CASE WHEN status = 'PENDING_PAYMENT' AND expires_at <= ${now} THEN 'EXPIRED'
                    ELSE status::text END AS status,
               count(*) AS count
        FROM orders
        GROUP BY 1`;
      return new Map(rows.map((r) => [r.status, Number(r.count)]));
    } catch (err) {
      this.logger.warn(`Could not read order metrics: ${describeError(err)}`);
      return null;
    }
  }
}
