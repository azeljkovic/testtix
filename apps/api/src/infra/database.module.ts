import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/** Provides `PrismaService` to every module. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
