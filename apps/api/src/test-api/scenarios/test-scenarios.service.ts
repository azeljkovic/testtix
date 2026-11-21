import { Injectable } from '@nestjs/common';

import { ClockService } from '../../clock/clock.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { uuidv7 } from '../../infra/uuid.js';
import { insertRows } from '../../seed/seed.js';
import { newScenarioSuffix, newTicketCode, type ScenarioContext } from './scenario-data.js';
import type { Scenario } from './scenarios.js';

/** Inserts seed scenarios (`POST /__test/seed/{scenario}`). */
@Injectable()
export class TestScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Builds a scenario for the current server time and inserts all of its rows in one
   * transaction. Only adds rows, so it is safe on a shared server.
   */
  async create<TResult>(build: (ctx: ScenarioContext) => Scenario<TResult>): Promise<TResult> {
    const now = await this.clock.now();
    const { rows, result } = build({
      now,
      suffix: newScenarioSuffix(),
      newId: () => uuidv7(now),
      newTicketCode,
    });
    await this.prisma.$transaction(async (tx) => {
      await insertRows(tx, rows);
    });
    return result;
  }
}
