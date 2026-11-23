import { api, API_BASE_URL, csrfHeader } from './client.js';
import { unwrap } from './errors.js';
import type { components } from './generated/openapi.js';

export type Order = components['schemas']['Order_Output'];
export type OrderItem = components['schemas']['OrderItem_Output'];
export type OrderSummary = components['schemas']['OrderSummary_Output'];
export type OrderPage = components['schemas']['OrderPage_Output'];

/**
 * `POST /orders`: checks out one of your holds. Returns the new order (or the hold's existing one):
 * send the customer to its `paymentUrl`, or (a free order, which has none) to its order page.
 */
export async function createOrder(holdId: string): Promise<Order> {
  return unwrap(
    await api.POST('/orders', { params: { header: await csrfHeader() }, body: { holdId } }),
  );
}

/** `GET /orders/{orderId}`: one of your orders. Poll it after `retryAfterMs` until that is null. */
export async function fetchOrder(orderId: string, signal?: AbortSignal): Promise<Order> {
  return unwrap(await api.GET('/orders/{orderId}', { params: { path: { orderId } }, signal }));
}

/** `GET /orders?page=…`: your orders, newest first. */
export async function fetchOrders(page: number, signal?: AbortSignal): Promise<OrderPage> {
  return unwrap(await api.GET('/orders', { params: { query: { page } }, signal }));
}

/**
 * Where to download a ticket's PDF (`GET /tickets/{ticketId}/pdf`). A plain link works: the browser
 * sends the session cookie to the API's origin, and the API answers with an attachment.
 */
export function ticketPdfUrl(ticketId: string): string {
  return `${API_BASE_URL}/tickets/${encodeURIComponent(ticketId)}/pdf`;
}
