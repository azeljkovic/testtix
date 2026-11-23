import { useQuery } from '@tanstack/react-query';
import { formatPrice, type OrderStatus } from '@testtix/shared';
import { Link, useSearchParams } from 'react-router';

import type { OrderSummary } from '../api/orders.js';
import { formatEventDateTime } from '../catalogue/format.js';
import { Pagination } from '../catalogue/Pagination.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { formatOrderedAt, ORDER_STATUS_LABELS } from '../orders/format.js';
import { orderQueries } from '../orders/queries.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';
const CELL = 'px-3 py-3 text-left align-top';

const BADGE_CLASS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'bg-sky-100 text-sky-900',
  PROCESSING: 'bg-sky-100 text-sky-900',
  CONFIRMED: 'bg-emerald-100 text-emerald-900',
  FAILED: 'bg-red-100 text-red-900',
  EXPIRED: 'bg-slate-200 text-slate-800',
};

/** `?page=2`; anything else is page 1. */
function pageParam(searchParams: URLSearchParams): number {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page > 1 ? page : 1;
}

/** `/orders`: your orders, newest first, each linking to its order page (and tickets). */
export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const page = pageParam(searchParams);
  const orders = useQuery(orderQueries.list(page));

  return (
    <>
      <PageTitle title="Your orders" />
      <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
      <p className="mt-2 text-slate-700">Open a confirmed order to see and download its tickets.</p>
      <section aria-labelledby="orders-heading" className="mt-8">
        <h2 id="orders-heading" className="sr-only">
          Order list
        </h2>
        {orders.isPending ? (
          <p role="status" className="text-slate-600">
            Loading your orders…
          </p>
        ) : orders.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-red-900">
            <p className="font-medium">
              We couldn’t load your orders. {errorMessage(orders.error)}
            </p>
            <button type="button" onClick={() => void orders.refetch()} className={LINK_CLASS}>
              Try again
            </button>
          </div>
        ) : orders.data.items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 text-slate-700">
            <p>
              {orders.data.total > 0
                ? 'There’s nothing on this page.'
                : 'You haven’t ordered any tickets yet.'}
            </p>
            <Link to={orders.data.total > 0 ? '/orders' : '/events'} className={LINK_CLASS}>
              {orders.data.total > 0 ? 'Go to the first page' : 'Browse events'}
            </Link>
          </div>
        ) : (
          <>
            <OrderTable orders={orders.data.items} />
            <Pagination
              page={page}
              totalPages={orders.data.totalPages}
              hrefFor={(target) => (target > 1 ? `/orders?page=${String(target)}` : '/orders')}
            />
          </>
        )}
      </section>
    </>
  );
}

function OrderTable({ orders }: { orders: OrderSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse">
        <caption className="sr-only">Your orders, newest first</caption>
        <thead className="border-b border-slate-300 text-sm text-slate-600">
          <tr>
            <th scope="col" className={CELL}>
              Event
            </th>
            <th scope="col" className={CELL}>
              Event date
            </th>
            <th scope="col" className={CELL}>
              Ordered
            </th>
            <th scope="col" className={`${CELL} text-right`}>
              Tickets
            </th>
            <th scope="col" className={`${CELL} text-right`}>
              Total
            </th>
            <th scope="col" className={CELL}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-slate-200">
              <th scope="row" className={`${CELL} font-normal`}>
                <Link to={`/orders/${order.id}`} className={LINK_CLASS}>
                  {order.event.title}
                </Link>
                <span className="block text-sm text-slate-600">{order.event.venue.name}</span>
              </th>
              <td className={CELL}>
                <time dateTime={order.event.startsAt}>
                  {formatEventDateTime(order.event.startsAt, order.event.venue.timezone)}
                </time>
              </td>
              <td className={CELL}>
                <time dateTime={order.createdAt}>{formatOrderedAt(order.createdAt)}</time>
              </td>
              <td className={`${CELL} text-right tabular-nums`}>{order.ticketCount}</td>
              <td className={`${CELL} text-right tabular-nums`}>{formatPrice(order.totalCents)}</td>
              <td className={CELL}>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${BADGE_CLASS[order.status]}`}
                >
                  {ORDER_STATUS_LABELS[order.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
