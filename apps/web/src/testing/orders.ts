import type { CreateOrderRequest, OrderStatus } from '@testtix/shared';
import { http, HttpResponse } from 'msw';

import { mockAdminRequest, type RecordedRequest } from './admin.js';
import { type Schemas, server } from './msw-server.js';

type Hold = Schemas['Hold_Output'];
type Order = Schemas['Order_Output'];
type OrderSummary = Schemas['OrderSummary_Output'];
type OrderPage = Schemas['OrderPage_Output'];
type CatalogueEvent = Schemas['CatalogueEventSummary_Output'];

export const FIXTURE_ORDER_ID = '01970000-0000-7000-8000-000000000c01';
/** The payment page of the fixture orders, on the fake provider. */
export const FIXTURE_PAYMENT_URL = 'http://localhost:4000/pay/fixture-session';

interface OrderOptions {
  id?: string;
  status?: OrderStatus;
  /** Defaults to the provider's page while `PENDING_PAYMENT`, else null (as the API sends). */
  paymentUrl?: string | null;
  /** Defaults to 1000 while the order can change (`PENDING_PAYMENT`, `PROCESSING`), else null. */
  retryAfterMs?: number | null;
  refundDue?: boolean;
}

/** A fixture ticket ID (the `n`th ticket of an order). */
export function fixtureTicketId(n: number): string {
  return `01970000-0000-7000-8000-0000000d${n.toString(16).padStart(4, '0')}`;
}

/** A fixture ticket code. */
export function fixtureTicketCode(n: number): string {
  return `TT-FIXTURE-${n.toString().padStart(4, '0')}`;
}

/**
 * The order the API would make from `hold` for `event`, in `status`: created when the hold was,
 * expiring with it. A `CONFIRMED` order has tickets (`fixtureTicketId(i)` / `fixtureTicketCode(i)`).
 */
export function orderOf(
  hold: Hold,
  event: CatalogueEvent,
  {
    id = FIXTURE_ORDER_ID,
    status = 'PENDING_PAYMENT',
    paymentUrl = status === 'PENDING_PAYMENT' ? FIXTURE_PAYMENT_URL : null,
    retryAfterMs = status === 'PENDING_PAYMENT' || status === 'PROCESSING' ? 1000 : null,
    refundDue = false,
  }: OrderOptions = {},
): Order {
  return {
    id,
    status,
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
      venue: { name: event.venue.name, timezone: event.venue.timezone },
    },
    totalCents: hold.totalCents,
    ticketCount: hold.items.length,
    expiresAt: hold.expiresAt,
    createdAt: hold.createdAt,
    updatedAt: hold.createdAt,
    items: hold.items.map((item, index) => ({
      ...item,
      ticket:
        status === 'CONFIRMED'
          ? { id: fixtureTicketId(index + 1), code: fixtureTicketCode(index + 1) }
          : null,
    })),
    paymentUrl,
    retryAfterMs,
    refundDue,
  };
}

/** `order` as `GET /orders` lists it. */
export function summaryOf(order: Order): OrderSummary {
  const { id, status, event, totalCents, ticketCount, expiresAt, createdAt } = order;
  return { id, status, event, totalCents, ticketCount, expiresAt, createdAt };
}

/** A page of `GET /orders`. */
export function orderPage(
  orders: Order[],
  { page = 1, pageSize = 20, total = orders.length }: Partial<OrderPage> = {},
): OrderPage {
  return {
    items: orders.map(summaryOf),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Answers `GET /api/orders/{orderId}` with the answers in turn, repeating the last one: an order,
 * or a `Response`. Returns the times each request arrived (`Date.now()`, the fake clock in tests
 * that fake it).
 */
export function mockOrder(orderId: string, ...answers: (Order | Response)[]): number[] {
  const requestedAt: number[] = [];
  server.use(
    http.get(`/api/orders/${orderId}`, () => {
      const answer = answers[Math.min(requestedAt.length, answers.length - 1)];
      requestedAt.push(Date.now());
      if (answer === undefined) throw new Error('mockOrder() needs an answer');
      return answer instanceof Response ? answer.clone() : HttpResponse.json(answer);
    }),
  );
  return requestedAt;
}

/** Answers `POST /api/orders` with `respond(body)` (an order: 201) and records each request. */
export function mockCreateOrder(
  respond: (body: CreateOrderRequest) => Order | Response,
): RecordedRequest[] {
  return mockAdminRequest('post', '/api/orders', ({ body }) => respond(body as CreateOrderRequest));
}

/** Answers `GET /api/orders` with `respond(page)` and returns the page of each request. */
export function mockOrderList(respond: (page: number) => OrderPage | Response): number[] {
  const pages: number[] = [];
  server.use(
    http.get('/api/orders', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
      pages.push(page);
      const answer = respond(page);
      return answer instanceof Response ? answer : HttpResponse.json(answer);
    }),
  );
  return pages;
}
