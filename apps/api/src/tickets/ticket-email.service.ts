import { Inject, Injectable } from '@nestjs/common';
import { formatPrice } from '@testtix/shared';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { type MailAttachment, MailService } from '../mail/mail.service.js';
import { eventTimeLabel, loadTicketDetails, placeLabel } from './ticket-details.js';
import { renderTicketsPdf, ticketQrPng } from './ticket-documents.js';

/** The web app's page for one order (C4.5). */
export function orderPageUrl(webBaseUrl: string, orderId: string): string {
  return `${webBaseUrl}/orders/${orderId}`;
}

/** Content-ID of a ticket's inline QR image. */
export function qrContentId(ticketId: string): string {
  return `qr-${ticketId}@testtix`;
}

/** File name of an order's tickets PDF. */
export function orderTicketsFileName(orderId: string): string {
  return `testtix-tickets-${orderId}.pdf`;
}

/**
 * The order confirmation email with the e-tickets (C4.4): an HTML and a text part, each ticket's
 * QR as an inline image, and one PDF with a page per ticket. Sent by the order processing job
 * after `finalize()` confirms an order; runs in the worker.
 *
 * Delivery is **at least once**: `tickets_emailed_at` is set after the SMTP server accepts the
 * message, so a crash between the two sends it again on the next run. A run for an order that is
 * not `CONFIRMED`, or whose email already went out, does nothing.
 */
@Injectable()
export class TicketEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Sends the order's e-ticket email if it is due. Returns whether it sent one. */
  async send(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        ticketsEmailedAt: true,
        totalCents: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (order?.status !== 'CONFIRMED' || order.ticketsEmailedAt !== null) return false;
    const tickets = await loadTicketDetails(this.prisma, { orderItem: { orderId } });
    const [first] = tickets;
    if (first === undefined) throw new Error(`Confirmed order ${orderId} has no tickets`);
    const { event } = first;

    const now = await this.clock.now();
    const [pdf, qrs] = await Promise.all([
      renderTicketsPdf(tickets, { now, title: `TestTix tickets – ${event.title}` }),
      Promise.all(tickets.map((ticket) => ticketQrPng(ticket.code))),
    ]);
    const inline: MailAttachment[] = tickets.map((ticket, index) => ({
      filename: `qr-${ticket.id}.png`,
      content: qrs[index] ?? Buffer.alloc(0),
      contentType: 'image/png',
      cid: qrContentId(ticket.id),
    }));

    await this.mail.send({
      to: { name: order.user.name, address: order.user.email },
      template: 'order-confirmed',
      data: {
        name: order.user.name,
        orderId,
        orderUrl: orderPageUrl(this.config.webBaseUrl, orderId),
        eventTitle: event.title,
        eventTime: eventTimeLabel(event.startsAt, event.venue.timezone),
        venue: `${event.venue.name}, ${event.venue.address}, ${event.venue.city}`,
        total: formatPrice(order.totalCents),
        tickets: tickets.map((ticket) => ({
          place: placeLabel(ticket),
          price: formatPrice(ticket.priceCents),
          code: ticket.code,
          qrCid: qrContentId(ticket.id),
        })),
      },
      attachments: [
        ...inline,
        { filename: orderTicketsFileName(orderId), content: pdf, contentType: 'application/pdf' },
      ],
    });
    await this.prisma.order.updateMany({
      where: { id: orderId, ticketsEmailedAt: null },
      data: { ticketsEmailedAt: now },
    });
    return true;
  }
}
