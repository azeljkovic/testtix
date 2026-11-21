import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CLOCK_MODES } from '../clock/clock-state.js';

/** Upper bound for one `advanceBy` step: 366 days. Call again to go further. */
export const MAX_ADVANCE_MS = 366 * 24 * 60 * 60 * 1000;

const CLOCK_COMMANDS = ['freezeAt', 'advanceBy', 'reset'] as const;

export const ClockCommandSchema = z
  .strictObject({
    freezeAt: z.iso
      .datetime({ offset: true })
      .optional()
      .describe(
        'Stop the clock at this ISO 8601 date-time (with `Z` or an offset, e.g. `2026-12-01T19:30:00Z`). It stays there until advanced or reset.',
      ),
    advanceBy: z
      .number()
      .int()
      .min(1)
      .max(MAX_ADVANCE_MS)
      .optional()
      .describe(
        'Move the clock forward by this many milliseconds (at most 366 days per call). A frozen clock stays frozen at the later time; a running clock keeps running.',
      ),
    reset: z.literal(true).optional().describe('`true` to go back to the real time.'),
  })
  .refine((body) => CLOCK_COMMANDS.filter((key) => body[key] !== undefined).length === 1, {
    message: 'Send exactly one of freezeAt, advanceBy or reset',
  })
  .describe('Exactly one of `freezeAt`, `advanceBy` or `reset`.');

export const ClockStateSchema = z.object({
  now: z.iso.datetime().describe('Server "now" as an ISO 8601 date-time in UTC'),
  mode: z
    .enum(CLOCK_MODES)
    .describe(
      '`real`: the real time. `frozen`: stopped at `now`. `offset`: running, shifted by `offsetMs`.',
    ),
  offsetMs: z
    .number()
    .int()
    .describe('Server "now" minus the real time, in milliseconds (0 in `real` mode)'),
});

export type ClockCommand = z.infer<typeof ClockCommandSchema>;

export class ClockCommandDto extends createZodDto(ClockCommandSchema) {}
export class ClockStateDto extends createZodDto(ClockStateSchema) {}
