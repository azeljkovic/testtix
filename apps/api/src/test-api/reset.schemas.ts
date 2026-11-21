import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { ClockStateSchema } from './clock.schemas.js';

export const ResetRequestSchema = z
  .strictObject({
    freezeAt: z.iso
      .datetime({ offset: true })
      .optional()
      .describe(
        'Freeze the clock at this ISO 8601 date-time (with `Z` or an offset) instead of resetting it to the real time. The data is then seeded relative to this date, so every reset with the same `freezeAt` day gives identical data.',
      ),
  })
  .describe('Optional. Send no body (or `{}`) to reset the clock to the real time.');

/** The body may be left out entirely: `curl -X POST .../__test/reset` sends none. */
export const OptionalResetRequestSchema = ResetRequestSchema.optional();

export const ResetResponseSchema = z.object({
  seedDay: z.iso
    .date()
    .describe('UTC date the seed data is relative to (`D` in the testing guide): the clock date'),
  clock: ClockStateSchema.describe('The server clock after the reset'),
  rows: z
    .object({
      venues: z.number().int(),
      sections: z.number().int(),
      seats: z.number().int(),
      events: z.number().int(),
      ticketBatches: z.number().int(),
      inventoryUnits: z.number().int(),
    })
    .describe('Rows inserted per table. Every other table is empty.'),
});

export type ResetRequest = z.infer<typeof ResetRequestSchema>;

export class ResetRequestDto extends createZodDto(ResetRequestSchema) {}
export class ResetResponseDto extends createZodDto(ResetResponseSchema) {}
