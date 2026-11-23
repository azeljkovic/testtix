import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../auth/auth.decorators.js';
import type { User } from '../generated/prisma/client.js';
import { TicketIdParamDto } from './tickets.schemas.js';
import { TicketsService } from './tickets.service.js';

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get(':ticketId/pdf')
  @ApiOperation({
    summary: 'Download one of your tickets as a PDF',
    description:
      'One A4 page with the ticket’s QR code (it encodes the ticket code), the code, the event, the venue and start time (in the venue’s time zone), the seat or GA section, the price and the order ID; the same page as in the e-ticket email’s PDF. Tickets exist once an order is `CONFIRMED`: find their IDs in `GET /orders/{orderId}` (`items[].ticket`). 404 for unknown tickets and other users’ tickets.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The PDF, as an attachment (`Content-Disposition`).',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Header('Cache-Control', 'private, no-store')
  async pdf(
    @CurrentUser() user: User,
    @Param() { ticketId }: TicketIdParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { fileName, content } = await this.tickets.pdf(user.id, ticketId);
    void reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${fileName}"`);
    return content;
  }
}
