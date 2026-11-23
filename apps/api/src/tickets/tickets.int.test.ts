import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PROBLEM_TYPE_BLANK, PROBLEM_TYPES } from '@testtix/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../infra/prisma.service.js';
import { QUEUE_PREFIX } from '../jobs/jobs.module.js';
import { MailService } from '../mail/mail.service.js';
import {
  ORDER_PROCESSING_QUEUE,
  OrderJobs,
  SEND_TICKETS_JOB,
  sendTicketsJobId,
} from '../orders/order-jobs.js';
import { OrderProcessingService, RECOVERY_GRACE_MS } from '../orders/order-processing.service.js';
import type { Order } from '../orders/orders.schemas.js';
import type { BatchSpec } from '../seed/fixtures.js';
import type { SessionClient } from '../testing/auth.js';
import { binaryBody, decodeQrPng, pdfPageCount, qrCodesInPdf } from '../testing/documents.js';
import {
  CHECKOUT_SALES_OPEN,
  checkout,
  checkoutCustomer,
  expectProblem,
  holdTickets,
  insertCheckoutEvent,
  parseOrder,
} from '../testing/integration/checkout.js';
import { createIntegrationApp } from '../testing/integration/integration-app.js';
import { type Email, emailPart, findEmails, waitForEmail } from '../testing/integration/mailpit.js';
import {
  type PaymentProviderStub,
  startPaymentProviderStub,
} from '../testing/payment-provider-stub.js';
import { paymentEvent, sendWebhook } from '../testing/webhooks.js';
import { TICKET_CODE_PATTERN } from './ticket-code.js';
import { orderTicketsFileName, qrContentId, TicketEmailService } from './ticket-email.service.js';

/** The server clock while testing (signatures are checked against the real time). */
const NOW = new Date('2027-03-01T12:00:00.000Z');
const WEB_BASE_URL = 'https://shop.example.test';

let app: NestFastifyApplication;
let prisma: PrismaService;
let clock: ClockService;
let provider: PaymentProviderStub;
let processing: OrderProcessingService;
let ticketEmail: TicketEmailService;
let queue: Queue;

beforeAll(async () => {
  queue = new Queue(ORDER_PROCESSING_QUEUE, {
    prefix: QUEUE_PREFIX,
    connection: { url: inject('integration').redisUrl },
  });
  await queue.obliterate({ force: true });
  provider = await startPaymentProviderStub();
  app = await createIntegrationApp({
    env: { TESTTIX_TEST_MODE: 'true', PAYMENTS_BASE_URL: provider.url, WEB_BASE_URL },
  });
  prisma = app.get(PrismaService);
  clock = app.get(ClockService);
  // The worker is off in integration tests: run the jobs' work directly.
  const config = app.get<AppConfig>(APP_CONFIG);
  processing = new OrderProcessingService(prisma, clock, app.get(OrderJobs), config);
  ticketEmail = new TicketEmailService(prisma, clock, app.get(MailService), config);
});

beforeEach(async () => {
  await clock.freezeAt(NOW);
});

afterAll(async () => {
  await clock.reset();
  await app.close();
  await provider.close();
  await queue.close();
});

type Customer = SessionClient & { user: { id: string; email: string } };

interface Checkout {
  title: string;
  customer: Customer;
  order: Order;
}

/** A customer's order for `body` (seats by label, GA by section name), paid or not yet. */
async function placeOrder(
  body: { seats?: string[]; ga?: Record<string, number> },
  options: { batches?: BatchSpec[] } = {},
): Promise<Checkout> {
  const event = await insertCheckoutEvent(app, { now: NOW, holdDurationSec: 600, ...options });
  const customer = await checkoutCustomer(app);
  const hold = await holdTickets(customer, event.id, {
    seats: (body.seats ?? []).map((label) => event.seat(label)),
    ga: Object.entries(body.ga ?? {}).map(([name, quantity]) => ({
      sectionId: event.section(name),
      quantity,
    })),
  });
  const order = parseOrder(await checkout(customer, hold.id), 201);
  return { title: event.title, customer, order };
}

/** Pays the order through a signed webhook and runs the processing job. */
async function payAndFinalize(
  { order }: Checkout,
  type: 'payment.succeeded' | 'payment.failed' = 'payment.succeeded',
) {
  const { paymentSessionId } = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentSessionId: true },
  });
  const res = await sendWebhook(app, paymentEvent({ ...order, paymentSessionId }, type));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return processing.finalize(order.id);
}

async function getOrder(customer: SessionClient, orderId: string): Promise<Order> {
  return parseOrder(await customer.get(`/orders/${orderId}`), 200);
}

async function ticketsOf(orderId: string) {
  return prisma.ticket.findMany({
    where: { orderItem: { orderId } },
    select: { id: true, code: true, issuedAt: true, orderItemId: true },
  });
}

function downloadPdf(client: SessionClient, ticketId: string) {
  return client.get(`/tickets/${ticketId}/pdf`).buffer(true).parse(binaryBody);
}

function subjectOf(title: string): string {
  return `Your tickets for ${title}`;
}

/** The e-ticket email's PDF and inline QR images, as bytes. */
async function documentsOf(email: Email) {
  const [pdf, ...otherAttachments] = email.attachments;
  expect(otherAttachments).toEqual([]);
  if (pdf === undefined) throw new Error('No PDF attached');
  return {
    pdf,
    pdfBytes: await emailPart(email, pdf),
    inline: await Promise.all(
      email.inline.map(async (part) => ({ ...part, bytes: await emailPart(email, part) })),
    ),
  };
}

describe('issuing tickets on confirmation', () => {
  it('issues one ticket per item, with unique unguessable codes, shown on the order', async () => {
    const placed = await placeOrder({ seats: ['A1', 'A2'], ga: { Floor: 1 } });
    const pending = await getOrder(placed.customer, placed.order.id);
    expect(pending.items.map((item) => item.ticket)).toEqual([null, null, null]);

    expect(await payAndFinalize(placed)).toBe('CONFIRMED');

    const tickets = await ticketsOf(placed.order.id);
    expect(tickets).toHaveLength(3);
    expect(new Set(tickets.map((t) => t.code)).size).toBe(3);
    for (const ticket of tickets) {
      expect(ticket.code).toMatch(TICKET_CODE_PATTERN);
      expect(ticket.issuedAt).toEqual(NOW);
    }
    const order = await getOrder(placed.customer, placed.order.id);
    expect(order.status).toBe('CONFIRMED');
    const byId = new Map(tickets.map((t) => [t.id, t.code]));
    for (const item of order.items) {
      expect(item.ticket).not.toBeNull();
      expect(byId.get(item.ticket?.id ?? '')).toBe(item.ticket?.code);
    }
  });

  it('issues them once when the job runs again', async () => {
    const placed = await placeOrder({ seats: ['A1'] });
    expect(await payAndFinalize(placed)).toBe('CONFIRMED');
    const first = await ticketsOf(placed.order.id);

    expect(await processing.finalize(placed.order.id)).toBeNull();
    await Promise.all([processing.finalize(placed.order.id), processing.finalize(placed.order.id)]);

    expect(await ticketsOf(placed.order.id)).toEqual(first);
  });

  it('issues no tickets and sends no email when the payment fails', async () => {
    const placed = await placeOrder({ seats: ['A1'], ga: { Floor: 1 } });
    expect(await payAndFinalize(placed, 'payment.failed')).toBe('FAILED');

    expect(await ticketsOf(placed.order.id)).toEqual([]);
    expect(await ticketEmail.send(placed.order.id)).toBe(false);
    expect(await findEmails(placed.customer.user.email)).toEqual([]);
    const order = await getOrder(placed.customer, placed.order.id);
    expect(order.items.map((item) => item.ticket)).toEqual([null, null]);
  });

  it('issues tickets for a free order too', async () => {
    const placed = await placeOrder(
      { seats: ['B1'], ga: { Floor: 2 } },
      {
        batches: [
          {
            name: 'Free',
            priceCents: 0,
            sections: ['Seats', 'Floor'],
            releases: CHECKOUT_SALES_OPEN,
          },
        ],
      },
    );
    expect(placed.order.status).toBe('PROCESSING');
    expect(await processing.finalize(placed.order.id)).toBe('CONFIRMED');
    expect(await ticketsOf(placed.order.id)).toHaveLength(3);
  });

  it('enqueues the e-ticket email once the order is confirmed', async () => {
    const placed = await placeOrder({ seats: ['A3'] });
    expect(await queue.getJob(sendTicketsJobId(placed.order.id))).toBeUndefined();

    await payAndFinalize(placed);

    const job = await queue.getJob(sendTicketsJobId(placed.order.id));
    expect(job).toMatchObject({ name: SEND_TICKETS_JOB, data: { orderId: placed.order.id } });
    await job?.remove();
  });
});

describe('the e-ticket email', () => {
  it('has the tickets as inline QR images and as a PDF with one page each', async () => {
    const placed = await placeOrder({ seats: ['A1', 'A2'], ga: { Floor: 1 } });
    await payAndFinalize(placed);
    const order = await getOrder(placed.customer, placed.order.id);
    const tickets = order.items.map((item) => {
      if (item.ticket === null) throw new Error('no ticket');
      return item.ticket;
    });

    expect(await ticketEmail.send(placed.order.id)).toBe(true);

    const email = await waitForEmail(placed.customer.user.email, subjectOf(placed.title));
    expect(email.date).toBe(NOW.toISOString().replace('.000Z', 'Z'));
    const { pdf, pdfBytes, inline } = await documentsOf(email);

    // The PDF: one page per ticket, in the order's order, each with its ticket's QR.
    expect(pdf).toMatchObject({
      fileName: orderTicketsFileName(placed.order.id),
      contentType: 'application/pdf',
    });
    expect(await pdfPageCount(pdfBytes)).toBe(3);
    expect(await qrCodesInPdf(pdfBytes)).toEqual(tickets.map((t) => t.code));

    // The body: each ticket's QR inline, referenced by Content-ID from the HTML part.
    expect(inline.map((part) => part.contentId).sort()).toEqual(
      tickets.map((t) => qrContentId(t.id)).sort(),
    );
    for (const ticket of tickets) {
      const image = inline.find((part) => part.contentId === qrContentId(ticket.id));
      expect(image?.contentType).toBe('image/png');
      expect(decodeQrPng(image?.bytes ?? Buffer.alloc(0))).toBe(ticket.code);
      expect(email.html).toContain(`src="cid:${qrContentId(ticket.id)}"`);
      expect(email.text).toContain(`Ticket code: ${ticket.code}`);
    }
    expect(email.text).toContain('- Seats · Row A · Seat 1 ($40.00)');
    expect(email.text).toContain('- Seats · Row A · Seat 2 ($40.00)');
    expect(email.text).toContain('- General admission – Floor ($25.00)');
    expect(email.text).toContain('Total: $105.00');
    expect(email.text).toContain(`View your order: ${WEB_BASE_URL}/orders/${placed.order.id}`);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(stored.ticketsEmailedAt).toEqual(NOW);
  });

  it.each([
    { kind: 'seated', body: { seats: ['B1', 'B2', 'B3'] }, pages: 3 },
    { kind: 'GA', body: { ga: { Floor: 2 } }, pages: 2 },
  ])('has a PDF page per ticket for a $kind order', async ({ body, pages }) => {
    const placed = await placeOrder(body);
    await payAndFinalize(placed);
    await ticketEmail.send(placed.order.id);

    const email = await waitForEmail(placed.customer.user.email, subjectOf(placed.title));
    const { pdfBytes, inline } = await documentsOf(email);
    const codes = (await ticketsOf(placed.order.id)).map((t) => t.code).sort();
    expect(await pdfPageCount(pdfBytes)).toBe(pages);
    expect((await qrCodesInPdf(pdfBytes)).sort()).toEqual(codes);
    expect(inline.map((part) => decodeQrPng(part.bytes)).sort()).toEqual(codes);
  });

  it('is sent once when the job runs again', async () => {
    const placed = await placeOrder({ seats: ['A1'] });
    await payAndFinalize(placed);

    expect(await ticketEmail.send(placed.order.id)).toBe(true);
    expect(await ticketEmail.send(placed.order.id)).toBe(false);

    await waitForEmail(placed.customer.user.email, subjectOf(placed.title));
    expect(await findEmails(placed.customer.user.email)).toHaveLength(1);
  });

  it('is enqueued again by the recovery job when it is overdue', async () => {
    const placed = await placeOrder({ seats: ['A2'] });
    await payAndFinalize(placed);
    const enqueued = await queue.getJob(sendTicketsJobId(placed.order.id));
    await enqueued?.remove();

    // Not overdue yet: a job may still be on its way.
    await clock.advanceBy(RECOVERY_GRACE_MS - 1);
    await processing.recoverStuck();
    expect(await queue.getJob(sendTicketsJobId(placed.order.id))).toBeUndefined();

    await clock.advanceBy(1);
    expect(await processing.recoverStuck()).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(sendTicketsJobId(placed.order.id));
    expect(job?.name).toBe(SEND_TICKETS_JOB);
    await job?.remove();

    // Once sent, it is no longer due.
    await ticketEmail.send(placed.order.id);
    await processing.recoverStuck();
    expect(await queue.getJob(sendTicketsJobId(placed.order.id))).toBeUndefined();
  });
});

describe('GET /tickets/{ticketId}/pdf', () => {
  async function confirmedTicket() {
    const placed = await placeOrder({ seats: ['B2'], ga: { Floor: 1 } });
    await payAndFinalize(placed);
    const order = await getOrder(placed.customer, placed.order.id);
    const [ticket] = order.items.map((item) => item.ticket);
    if (ticket === null || ticket === undefined) throw new Error('no ticket');
    return { ...placed, ticket };
  }

  it('downloads the owner’s ticket as a one-page PDF with its QR', async () => {
    const { customer, ticket } = await confirmedTicket();

    const res = await downloadPdf(customer, ticket.id);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="testtix-ticket-${ticket.id}.pdf"`,
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    const pdf = res.body as Buffer;
    expect(await pdfPageCount(pdf)).toBe(1);
    expect(await qrCodesInPdf(pdf)).toEqual([ticket.code]);
  });

  it('answers 404 for another customer’s ticket and for unknown tickets', async () => {
    const { ticket } = await confirmedTicket();
    const someoneElse = await checkoutCustomer(app);

    expectProblem(await someoneElse.get(`/tickets/${ticket.id}/pdf`), 404, PROBLEM_TYPE_BLANK);
    expectProblem(
      await someoneElse.get('/tickets/019ac6b2-0000-7000-8000-000000000000/pdf'),
      404,
      PROBLEM_TYPE_BLANK,
    );
  });

  it('answers 400 for a malformed ID and 401 without a session', async () => {
    const { customer, ticket } = await confirmedTicket();

    expectProblem(
      await customer.get('/tickets/not-a-uuid/pdf'),
      400,
      PROBLEM_TYPES.VALIDATION_ERROR,
    );
    const anonymous = await request(app.getHttpServer()).get(`/tickets/${ticket.id}/pdf`);
    expectProblem(anonymous, 401, PROBLEM_TYPE_BLANK);
  });
});
