import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HoldSweeperProcessor, HOLD_SWEEPER_QUEUE } from './hold-sweeper.processor.js';
import { HoldSweeperSchedule } from './hold-sweeper.schedule.js';
import { HoldSweeperService } from './hold-sweeper.service.js';

/** The repeatable job that cleans up expired holds (C3.2). Part of the worker (`WorkerModule`). */
@Module({
  imports: [BullModule.registerQueue({ name: HOLD_SWEEPER_QUEUE })],
  providers: [HoldSweeperService, HoldSweeperProcessor, HoldSweeperSchedule],
  exports: [HoldSweeperService],
})
export class HoldSweeperModule {}
