import { Global, Module } from '@nestjs/common';

import { ClockService } from './clock.service.js';

/** Provides `ClockService`, the only source of server "now", to every module. */
@Global()
@Module({
  providers: [ClockService],
  exports: [ClockService],
})
export class ClockModule {}
