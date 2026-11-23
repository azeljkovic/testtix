import { useQuery } from '@tanstack/react-query';
import { formatPrice, type OrderStatus } from '@testtix/shared';
import { Link, useParams } from 'react-router';

import { ApiError } from '../api/errors.js';
import { type Order, ticketPdfUrl } from '../api/orders.js';
import { useSession } from '../auth/session.js';
import { formatEventDateTime, formatTicketPrice, ticketCount } from '../catalogue/format.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { formatOrderedAt, ticketPlace } from '../orders/format.js';
import { orderQueries } from '../orders/queries.js';
import { useCountdown } from '../seats/countdown.js';
import { HeldTickets, TimeLeft } from '../seats/HeldTickets.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';
const PRIMARY_LINK_CLASS =
  'rounded-md bg-indigo-700 px-5 py-2.5 text-center font-semibold text-white hover:bg-indigo-800';
const SECONDARY_LINK_CLASS =
  'rounded-md border border-slate-300 bg-white px-5 py-2.5 text-center font-semibold text-slate-800 hover:bg-slate-100';

/** The heading of each status: also the page title. */
const STATUS_HEADINGS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Waiting for your payment',
  PROCESSING: 'Processing your payment',
  CONFIRMED: 'Your tickets are confirmed',
  FAILED: 'Payment failed',
  EXPIRED: 'Order expired',
};

const STATUS_PANEL_CLASS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'border-sky-300 bg-sky-50 text-sky-950',
  PROCESSING: 'border-sky-300 bg-sky-50 text-sky-950',
  CONFIRMED: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  FAILED: 'border-red-300 bg-red-50 text-red-950',
  EXPIRED: 'border-amber-300 bg-amber-50 text-amber-950',
};

/**
 * `/orders/:orderId`: where the payment provider returns the customer, and where the e-ticket
 * email links. The order is polled (every `retryAfterMs`) until its status is final; each status
 * says what happened and what to do next, and a confirmed order lists its tickets with PDF
 * downloads. Behind `RequireAuth`.
 */
export function OrderPage() {
  const { orderId = '' } = useParams();
  const order = useQuery(orderQueries.order(orderId));

  if (order.data === undefined) {
    if (order.isError) {
      // 400: not an order ID at all.
      const notFound =
        order.error instanceof ApiError &&
        (order.error.status === 404 || order.error.status === 400);
      if (notFound) return <OrderNotFound />;
      return (
        <>
          <PageTitle title="Order unavailable" />
          <h1 className="text-3xl font-bold tracking-tight">We couldn’t load your order</h1>
          <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
            <p>{errorMessage(order.error)}</p>
            <button type="button" onClick={() => void order.refetch()} className={LINK_CLASS}>
              Try again
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        <PageTitle title="Loading order" />
        <p role="status" className="text-slate-600">
          Loading your order…
        </p>
      </>
    );
  }

  return (
    <OrderDetails
      order={order.data}
      onDeadline={() => void order.refetch()}
      // A failed poll keeps the last answer on screen; polling carries on.
      pollError={order.isError ? errorMessage(order.error) : undefined}
    />
  );
}

function OrderNotFound() {
  return (
    <>
      <PageTitle title="Order not found" />
      <h1 className="text-3xl font-bold tracking-tight">Order not found</h1>
      <p className="mt-4 text-slate-600">
        There’s no order of yours at this address. If someone sent you this link, log in with the
        account that placed the order.
      </p>
      <Link to="/orders" className={`mt-6 inline-block ${LINK_CLASS}`}>
        Your orders
      </Link>
    </>
  );
}

interface OrderDetailsProps {
  order: Order;
  /** Called when an unpaid order's time runs out by the browser clock. */
  onDeadline: () => void;
  pollError: string | undefined;
}

function OrderDetails({ order, onDeadline, pollError }: OrderDetailsProps) {
  const { event, status } = order;
  const eventHref = `/events/${event.slug}`;

  return (
    <>
      <PageTitle title={STATUS_HEADINGS[status]} />
      <Link to="/orders" className={LINK_CLASS}>
        ‹ Your orders
      </Link>
      {/* One live region for the whole status, so each change is announced. */}
      <div
        role="status"
        className={`mt-6 flex flex-col gap-2 rounded-lg border p-5 ${STATUS_PANEL_CLASS[status]}`}
      >
        <h1 className="text-3xl font-bold tracking-tight">{STATUS_HEADINGS[status]}</h1>
        <StatusMessage order={order} />
      </div>
      {pollError !== undefined && (
        <p className="mt-3 text-sm text-slate-700">
          We couldn’t check for updates: {pollError} We’ll keep trying.
        </p>
      )}
      {order.refundDue && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
          We received a payment for this order that it couldn’t use, so no tickets were sold for it.
          The payment will be refunded.
        </p>
      )}

      {status === 'PENDING_PAYMENT' && (
        <PendingPayment key={order.expiresAt} order={order} onDeadline={onDeadline} />
      )}
      {(status === 'FAILED' || status === 'EXPIRED') && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={`${eventHref}/seats`} className={PRIMARY_LINK_CLASS}>
            Choose tickets again
          </Link>
          <Link to={eventHref} className={SECONDARY_LINK_CLASS}>
            Back to the event
          </Link>
        </div>
      )}

      <section aria-labelledby="order-summary-heading" className="mt-10 flex flex-col gap-4">
        <h2 id="order-summary-heading" className="text-xl font-semibold">
          Order summary
        </h2>
        <dl className="grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="font-medium text-slate-600">Event</dt>
          <dd>
            <Link to={eventHref} className={LINK_CLASS}>
              {event.title}
            </Link>
          </dd>
          <dt className="font-medium text-slate-600">When</dt>
          <dd>
            <time dateTime={event.startsAt}>
              {formatEventDateTime(event.startsAt, event.venue.timezone)}
            </time>
          </dd>
          <dt className="font-medium text-slate-600">Venue</dt>
          <dd>{event.venue.name}</dd>
          <dt className="font-medium text-slate-600">Order number</dt>
          <dd className="font-mono text-sm break-all">{order.id}</dd>
          <dt className="font-medium text-slate-600">Ordered</dt>
          <dd>
            <time dateTime={order.createdAt}>{formatOrderedAt(order.createdAt)}</time>
          </dd>
        </dl>
        {status === 'CONFIRMED' ? (
          <TicketList order={order} />
        ) : (
          <div className="flex max-w-2xl flex-col gap-2">
            <HeldTickets
              items={order.items}
              totalCents={order.totalCents}
              label="Tickets in this order"
              tone="slate"
            />
          </div>
        )}
      </section>
    </>
  );
}

function StatusMessage({ order }: { order: Order }) {
  const { data: session } = useSession();
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return (
        <p>
          We haven’t heard from the payment provider yet. If you’ve paid, this page updates by
          itself in a moment. If you haven’t, continue to the payment page.
        </p>
      );
    case 'PROCESSING':
      return (
        <p>
          The payment provider has answered and we’re finishing your order. This usually takes a few
          seconds; this page updates by itself.
        </p>
      );
    case 'CONFIRMED':
      return (
        <p>
          {ticketCount(order.items.length)} for {order.event.title}.
          {session?.user.email === undefined
            ? ' We’ve emailed them to you.'
            : ` We’ve emailed them to ${session.user.email}.`}{' '}
          You can also download each ticket below.
        </p>
      );
    case 'FAILED':
      return (
        <p>
          Your payment didn’t go through, so you haven’t paid and the tickets were released. You can
          choose tickets and try again.
        </p>
      );
    case 'EXPIRED':
      return (
        <p>
          This order wasn’t paid while its tickets were held, so the tickets were released. You can
          choose tickets and try again.
        </p>
      );
  }
}

/** The countdown to `expiresAt` and the way back to the payment page. Keyed by `expiresAt`. */
function PendingPayment({ order, onDeadline }: { order: Order; onDeadline: () => void }) {
  const left = useCountdown(order.expiresAt, { onExpire: onDeadline });
  return (
    <div className="mt-6 flex max-w-md flex-col gap-4">
      <TimeLeft seconds={left} label="Time left to pay" />
      <div className="flex flex-wrap gap-3">
        {order.paymentUrl !== null && (
          <a href={order.paymentUrl} className={PRIMARY_LINK_CLASS}>
            Continue to payment
          </a>
        )}
        <Link to={`/events/${order.event.slug}/seats`} className={SECONDARY_LINK_CLASS}>
          Change tickets
        </Link>
      </div>
    </div>
  );
}

/** A confirmed order's tickets: place, price, code and a PDF download each. */
function TicketList({ order }: { order: Order }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h3 className="text-lg font-semibold">Your tickets</h3>
      <ul aria-label="Your tickets" className="flex flex-col divide-y divide-slate-200">
        {order.items.map((item) => {
          const place = ticketPlace(item);
          return (
            <li
              key={item.inventoryUnitId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3"
            >
              <span className="grow font-medium">{place}</span>
              <span className="tabular-nums">{formatTicketPrice(item.priceCents)}</span>
              {item.ticket !== null && (
                <span className="flex w-full flex-wrap items-baseline justify-between gap-x-4 text-sm text-slate-600">
                  <span>
                    Ticket code <span className="font-mono text-slate-900">{item.ticket.code}</span>
                  </span>
                  <a href={ticketPdfUrl(item.ticket.id)} download className={LINK_CLASS}>
                    Download PDF<span className="sr-only">: {place}</span>
                  </a>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex justify-between border-t border-slate-300 pt-3 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatPrice(order.totalCents)}</span>
      </p>
    </div>
  );
}
