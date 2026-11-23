import { performance } from 'node:perf_hooks';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, type Registry } from '@prometheus-io/client';

import { describeError } from '../logging/describe-error.js';
import { METRICS_REGISTRY } from '../metrics/metrics.module.js';
import { type QueueStats, QueueStore } from './queue-store.js';

/** One Redis read serves every queue metric of a scrape. */
const SNAPSHOT_MAX_AGE_MS = 1000;

/**
 * Waiting-room metrics on `/metrics` (C5.1), read from Redis at scrape time, so every API replica
 * reports the same numbers whichever process runs the admission job. Without Redis they are left
 * out rather than failing the scrape.
 */
@Injectable()
export class QueueMetrics implements OnModuleInit {
  private readonly logger = new Logger(QueueMetrics.name);
  private snapshot: { at: number; stats: Promise<QueueStats[]> } | undefined;

  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
    private readonly store: QueueStore,
  ) {}

  onModuleInit(): void {
    const read = () => this.stats();
    new Gauge({
      name: 'testtix_waiting_room_queue_length',
      help: 'Customers waiting in an event’s waiting room',
      labelNames: ['event_id'],
      registers: [this.registry],
      async collect() {
        const stats = await read();
        this.reset();
        for (const s of stats) this.set({ event_id: s.eventId }, s.waiting);
      },
    });
    new Counter({
      name: 'testtix_waiting_room_admitted_total',
      help: 'Customers let in from an event’s waiting room',
      labelNames: ['event_id'],
      registers: [this.registry],
      async collect() {
        const stats = await read();
        this.reset();
        for (const s of stats) this.inc({ event_id: s.eventId }, s.admittedTotal);
      },
    });
    new Gauge({
      name: 'testtix_waiting_room_admission_rate',
      help: 'Customers per second an event’s waiting room lets in (0: everyone at once, waiting room turned off)',
      labelNames: ['event_id'],
      registers: [this.registry],
      async collect() {
        const stats = await read();
        this.reset();
        for (const s of stats) {
          if (s.ratePerSec !== null) this.set({ event_id: s.eventId }, s.ratePerSec);
        }
      },
    });
  }

  private stats(): Promise<QueueStats[]> {
    const now = performance.now();
    if (this.snapshot === undefined || now - this.snapshot.at > SNAPSHOT_MAX_AGE_MS) {
      this.snapshot = { at: now, stats: this.readStats() };
    }
    return this.snapshot.stats;
  }

  private async readStats(): Promise<QueueStats[]> {
    if (!this.store.isReady()) return [];
    try {
      return await this.store.stats();
    } catch (err) {
      this.logger.warn(`Could not read waiting-room metrics: ${describeError(err)}`);
      return [];
    }
  }
}
