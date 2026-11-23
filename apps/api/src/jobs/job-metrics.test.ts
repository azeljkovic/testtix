import { EventEmitter } from 'node:events';

import { WorkerHost } from '@nestjs/bullmq';
import type { DiscoveryService } from '@nestjs/core';
import { Registry } from '@prometheus-io/client';
import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { JobMetrics } from './job-metrics.js';

class FakeProcessor extends WorkerHost {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

/** A processor whose `worker` is an event emitter named after its queue. */
function processorFor(queue: string): { host: FakeProcessor; worker: EventEmitter } {
  const host = new FakeProcessor();
  const worker = Object.assign(new EventEmitter(), { name: queue });
  Object.defineProperty(host, 'worker', { value: worker });
  return { host, worker };
}

/** A `Queue` without a Redis connection, answering `getJobCounts()` with `counts`. */
function queueFor(name: string, counts: () => Promise<Record<string, number>>): Queue {
  const queue = Object.create(Queue.prototype) as Queue;
  Object.defineProperty(queue, 'name', { value: name });
  Object.defineProperty(queue, 'getJobCounts', { value: counts });
  return queue;
}

function setup(...instances: unknown[]) {
  const registry = new Registry();
  const discovery = {
    getProviders: () => instances.map((instance) => ({ instance })),
  } as unknown as DiscoveryService;
  const metrics = new JobMetrics(registry, discovery);
  metrics.onApplicationBootstrap();
  return registry;
}

const T = 1_800_000_000_000;

function job(fields: {
  name?: string;
  timestamp: number;
  delay?: number;
  processedOn?: number;
  finishedOn?: number;
  attemptsMade?: number;
}) {
  return {
    name: fields.name ?? 'sweep',
    timestamp: fields.timestamp,
    // BullMQ zeroes this once a delayed job is due; the original delay stays in `opts`.
    delay: 0,
    opts: { delay: fields.delay },
    processedOn: fields.processedOn,
    finishedOn: fields.finishedOn,
    attemptsMade: fields.attemptsMade ?? 0,
  };
}

describe('JobMetrics', () => {
  it('measures lag from when a job was due, its delay included', async () => {
    const { host, worker } = processorFor('hold-sweeper');
    const registry = setup(host);

    // A scheduled run added a minute ahead, started 40 ms after it was due.
    worker.emit('active', job({ timestamp: T, delay: 60_000, processedOn: T + 60_040 }));
    // A job without a delay, started 2 s after it was added.
    worker.emit('active', job({ timestamp: T, processedOn: T + 2000 }));
    // A retry: its wait is the backoff, not lag.
    worker.emit('active', job({ timestamp: T, processedOn: T + 30_000, attemptsMade: 1 }));

    const text = await registry.metrics();
    expect(text).toContain('testtix_job_wait_seconds_count{queue="hold-sweeper",name="sweep"} 2');
    expect(text).toContain('testtix_job_wait_seconds_sum{queue="hold-sweeper",name="sweep"} 2.04');
    expect(text).toContain(
      'testtix_job_wait_seconds_bucket{le="0.05",queue="hold-sweeper",name="sweep"} 1',
    );
  });

  it('measures run time by outcome', async () => {
    const { host, worker } = processorFor('order-processing');
    const registry = setup(host);

    const timing = { timestamp: T, processedOn: T + 10, finishedOn: T + 260 };
    worker.emit('completed', job({ name: 'finalize', ...timing }));
    worker.emit('failed', job({ name: 'finalize', ...timing }));
    worker.emit('failed', undefined);

    const text = await registry.metrics();
    const labels = 'queue="order-processing",name="finalize"';
    expect(text).toContain(`testtix_job_duration_seconds_sum{${labels},outcome="completed"} 0.25`);
    expect(text).toContain(`testtix_job_duration_seconds_count{${labels},outcome="failed"} 1`);
  });

  it('reports jobs per queue and state, leaving out a queue that does not answer', async () => {
    const registry = setup(
      queueFor('hold-sweeper', () =>
        Promise.resolve({ waiting: 0, active: 1, delayed: 1, failed: 2 }),
      ),
      queueFor('waiting-room', () => new Promise(() => undefined)),
    );

    const text = await registry.metrics();
    expect(text).toContain('testtix_job_queue_jobs{queue="hold-sweeper",state="active"} 1');
    expect(text).toContain('testtix_job_queue_jobs{queue="hold-sweeper",state="failed"} 2');
    expect(text).not.toContain('queue="waiting-room"');
  });
});
