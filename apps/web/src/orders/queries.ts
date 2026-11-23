import { queryOptions } from '@tanstack/react-query';

import { fetchOrder, fetchOrders } from '../api/orders.js';

/** Query options for your orders (`GET /orders`, `GET /orders/{orderId}`). */
export const orderQueries = {
  all: ['orders'] as const,
  list: (page: number) =>
    queryOptions({
      queryKey: ['orders', 'list', page],
      queryFn: ({ signal }) => fetchOrders(page, signal),
      // Statuses change in the background (payments, expiry).
      staleTime: 0,
    }),
  /**
   * One order, polled while it can still change: the next request waits the `retryAfterMs` of the
   * last response (TanStack Query restarts the interval on every update), and polling stops once
   * the API says null (a final status).
   */
  order: (orderId: string) =>
    queryOptions({
      queryKey: ['orders', 'detail', orderId],
      queryFn: ({ signal }) => fetchOrder(orderId, signal),
      staleTime: 0,
      refetchInterval: (query) => query.state.data?.retryAfterMs ?? false,
    }),
};
