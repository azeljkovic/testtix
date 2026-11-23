import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TicketIdParamSchema = z.object({ ticketId: z.uuid() });

export class TicketIdParamDto extends createZodDto(TicketIdParamSchema) {}
