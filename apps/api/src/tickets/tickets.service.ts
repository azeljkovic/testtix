import { Injectable, NotFoundException } from '@nestjs/common';

import { ClockService } from '../clock/clock.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { loadTicketDetails } from './ticket-details.js';
import { renderTicketsPdf } from './ticket-documents.js';

export interface TicketPdf {
  fileName: string;
  content: Buffer;
}

/** File name of one ticket's PDF. */
export function ticketFileName(ticketId: string): string {
  return `testtix-ticket-${ticketId}.pdf`;
}

/** Customers' tickets (C4.4). */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /**
   * One page with the ticket, as in the e-ticket email's PDF. 404 for unknown tickets and other
   * users' tickets, so nobody learns which ticket IDs exist.
   */
  async pdf(userId: string, ticketId: string): Promise<TicketPdf> {
    const [ticket] = await loadTicketDetails(this.prisma, {
      id: ticketId,
      orderItem: { order: { userId } },
    });
    if (ticket === undefined) throw new NotFoundException('You have no ticket with this ID.');
    const content = await renderTicketsPdf([ticket], {
      now: await this.clock.now(),
      title: `TestTix ticket – ${ticket.event.title}`,
    });
    return { fileName: ticketFileName(ticket.id), content };
  }
}
