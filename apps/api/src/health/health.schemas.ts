import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LivenessSchema = z.object({
  status: z.literal('ok'),
});

export const DependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']).describe('`down` if the dependency failed or timed out'),
});

export const ReadinessSchema = z.object({
  status: z.enum(['ok', 'error']).describe('`ok` only when every check is `up`'),
  checks: z.object({
    database: DependencyCheckSchema,
    redis: DependencyCheckSchema,
  }),
});

export type DependencyCheck = z.infer<typeof DependencyCheckSchema>;
export type Readiness = z.infer<typeof ReadinessSchema>;

export class LivenessDto extends createZodDto(LivenessSchema) {}
export class ReadinessDto extends createZodDto(ReadinessSchema) {}
