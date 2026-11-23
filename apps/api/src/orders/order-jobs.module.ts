import { Module } from '@nestjs/common';

import { OrderJobs } from './order-jobs.js';

/** Enqueues order processing jobs; used by the API (webhooks, free orders) and the worker. */
@Module({
  providers: [OrderJobs],
  exports: [OrderJobs],
})
export class OrderJobsModule {}
