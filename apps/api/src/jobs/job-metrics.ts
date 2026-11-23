import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Gauge, Histogram, type Registry } from '@prometheus-io/client';
import { type Job, Queue, type Worker } from 'bullmq';

import { describeError } from '../logging/describe-error.js';
import { METRICS_REGISTRY } from '../metrics/metrics.tokens.js';

/** Job states `testtix_job_queue_jobs` reports. */
export const JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** A scrape gives up on a queue's counts after this long (Redis down), rather than hanging. */
const COUNTS_TIMEOUT_MS = 1000;

/** Seconds; job schedules run every 100 ms to minutes, so lag starts at milliseconds. */
const SECONDS_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

/**
 * Background job metrics on the worker's `/metrics` (C6.2), for every BullMQ processor and queue
 * of the process: how long a job waited past its due time before a worker took it (job lag), how
 * long it ran, and the jobs in each queue by state (read from Redis at scrape time).
 */
@Injectable()
export class JobMetrics implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobMetrics.name);
  private readonly wait: Histogram<'queue' | 'name'>;
  private readonly duration: Histogram<'queue' | 'name' | 'outcome'>;
  /** By name: a queue registered by two modules is counted once. */
  private readonly queues = new Map<string, Queue>();

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly discovery: DiscoveryService,
  ) {
    this.wait = new Histogram({
      name: 'testtix_job_wait_seconds',
      help: 'Time from when a background job was due (added, or its delay ended) until a worker started its first attempt',
      labelNames: ['queue', 'name'],
      buckets: SECONDS_BUCKETS,
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'testtix_job_duration_seconds',
      help: 'Run time of a background job attempt, by outcome (completed or failed)',
      labelNames: ['queue', 'name', 'outcome'],
      buckets: SECONDS_BUCKETS,
      registers: [registry],
    });
    const read = () => this.counts();
    new Gauge({
      name: 'testtix_job_queue_jobs',
      help: 'Jobs in a background job queue, by state',
      labelNames: ['queue', 'state'],
      registers: [registry],
      async collect() {
        const counts = await read();
        this.reset();
        for (const { queue, state, count } of counts) this.set({ queue, state }, count);
      },
    });
  }

  /** After `@nestjs/bullmq` has created the workers (in its `onModuleInit`). */
  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (instance instanceof WorkerHost) this.observe(instance.worker as Worker);
      if (instance instanceof Queue) this.queues.set(instance.name, instance as Queue);
    }
  }

  private observe(worker: Worker): void {
    const queue = worker.name;
    worker.on('active', (job: Job) => {
      // Retries wait for their backoff on purpose: only a job's first attempt shows lag.
      if (job.processedOn === undefined || job.attemptsMade > 0) return;
      // `opts.delay`, not `job.delay`: BullMQ zeroes the latter once a delayed job is due (which
      // is how job schedules enqueue their runs).
      const dueAt = job.timestamp + (job.opts.delay ?? 0);
      this.wait.observe({ queue, name: job.name }, Math.max(0, job.processedOn - dueAt) / 1000);
    });
    const finished = (job: Job | undefined, outcome: 'completed' | 'failed') => {
      if (job?.processedOn === undefined || job.finishedOn === undefined) return;
      this.duration.observe(
        { queue, name: job.name, outcome },
        Math.max(0, job.finishedOn - job.processedOn) / 1000,
      );
    };
    worker.on('completed', (job: Job) => {
      finished(job, 'completed');
    });
    worker.on('failed', (job: Job | undefined) => {
      finished(job, 'failed');
    });
  }

  private async counts(): Promise<{ queue: string; state: string; count: number }[]> {
    const perQueue = await Promise.all(
      [...this.queues.values()].map(async (queue) => {
        try {
          const counts = await withTimeout(queue.getJobCounts(...JOB_STATES), COUNTS_TIMEOUT_MS);
          return JOB_STATES.map((state) => ({
            queue: queue.name,
            state,
            count: counts[state] ?? 0,
          }));
        } catch (err) {
          this.logger.warn(
            `Could not read the ${queue.name} queue's metrics: ${describeError(err)}`,
          );
          return [];
        }
      }),
    );
    return perQueue.flat();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${String(ms)} ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
