import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPrice } from '@testtix/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { CatalogueEvent } from '../api/catalogue.js';
import { ApiError } from '../api/errors.js';
import type { Hold } from '../api/holds.js';
import { createOrder } from '../api/orders.js';
import { browserLocation } from '../app/browser-location.js';
import { ResendVerification } from '../auth/ResendVerification.js';
import { SESSION_QUERY_KEY, useSession } from '../auth/session.js';
import { EventNotFound } from '../catalogue/EventNotFound.js';
import { formatEventDateTime } from '../catalogue/format.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { FormAlert } from '../forms/FormAlert.js';
import { errorMessage } from '../forms/form-errors.js';
import { PageTitle } from '../layout/PageTitle.js';
import { orderQueries } from '../orders/queries.js';
import { useCountdown } from '../seats/countdown.js';
import { HeldTickets, TimeLeft } from '../seats/HeldTickets.js';
import { seatQueries } from '../seats/queries.js';

const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

const CHECKOUT_ERRORS = {
  EMAIL_NOT_VERIFIED: 'Verify your email address before you check out.',
  EVENT_NOT_ON_SALE: 'Tickets for this event are no longer on sale, so you can’t check out.',
  PAYMENT_PROVIDER_UNAVAILABLE:
    'We couldn’t reach the payment provider. Your tickets are still held: try again in a moment.',
} as const;

/**
 * `/events/:slug/checkout`: review the tickets you hold for the event, with the hold's countdown,
 * then go to the payment page (`POST /orders` → `paymentUrl`). A free order has no payment page:
 * it goes straight to its order page. Behind `RequireAuth`.
 */
export function CheckoutPage() {
  const { slug = '' } = useParams();
  const event = useQuery(catalogueQueries.event(slug));
  const eventId = event.data?.id;
  const hold = useQuery({
    ...seatQueries.currentHold(eventId ?? ''),
    enabled: eventId !== undefined,
  });

  const error = event.error ?? hold.error;
  if (error !== null) {
    if (error instanceof ApiError && error.status === 404) return <EventNotFound />;
    return (
      <>
        <PageTitle title="Checkout unavailable" />
        <h1 className="text-3xl font-bold tracking-tight">We couldn’t load your checkout</h1>
        <div role="alert" className="mt-4 flex flex-col items-start gap-3 text-slate-700">
          <p>{errorMessage(error)}</p>
          <button
            type="button"
            onClick={() => void (event.isError ? event.refetch() : hold.refetch())}
            className={LINK_CLASS}
          >
            Try again
          </button>
        </div>
      </>
    );
  }
  if (event.data === undefined || hold.data === undefined) {
    return (
      <>
        <PageTitle title="Loading checkout" />
        <p role="status" className="text-slate-600">
          Loading your tickets…
        </p>
      </>
    );
  }
  return <Checkout event={event.data} hold={hold.data} />;
}

function Checkout({ event, hold }: { event: CatalogueEvent; hold: Hold | null }) {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);
  const seatsHref = `/events/${event.slug}/seats`;

  const expire = () => {
    setExpired(true);
    queryClient.setQueryData(seatQueries.currentHold(event.id).queryKey, null);
    void queryClient.invalidateQueries({ queryKey: seatQueries.seatMapKey(event.id) });
  };

  return (
    <>
      <PageTitle title={`Check out: ${event.title}`} />
      <Link to={seatsHref} className={LINK_CLASS}>
        ‹ Back to the seat map
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Check out</h1>
      <p className="mt-2 text-lg text-slate-700">
        {event.title} ·{' '}
        <time dateTime={event.startsAt}>
          {formatEventDateTime(event.startsAt, event.venue.timezone)}
        </time>{' '}
        · {event.venue.name}
      </p>
      {expired ? (
        <div
          role="alert"
          className="mt-6 flex flex-col items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <p className="font-semibold">Your hold expired</p>
          <p>The tickets were released before you paid. Choose your tickets and hold them again.</p>
          <Link to={seatsHref} className={LINK_CLASS}>
            Choose tickets again
          </Link>
        </div>
      ) : hold === null ? (
        <div className="mt-6 flex flex-col items-start gap-3">
          <p className="text-slate-700">
            You have no tickets on hold for this event. If you’ve just paid, your order is in your
            orders.
          </p>
          <Link to={seatsHref} className={LINK_CLASS}>
            Choose tickets
          </Link>
          <Link to="/orders" className={LINK_CLASS}>
            Your orders
          </Link>
        </div>
      ) : (
        <HoldCheckout key={hold.id} event={event} hold={hold} onExpire={expire} />
      )}
    </>
  );
}

/** The held tickets, the countdown and the pay button. Keyed by the hold, like `HoldPanel`. */
function HoldCheckout({
  event,
  hold,
  onExpire,
}: {
  event: CatalogueEvent;
  hold: Hold;
  onExpire: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [announcement, setAnnouncement] = useState('');
  // Set once the payment page is opening: the button stays busy until the browser leaves.
  const [redirecting, setRedirecting] = useState(false);
  const left = useCountdown(hold.expiresAt, {
    onExpire,
    onLastMinute: () => {
      setAnnouncement('Less than a minute left on your hold.');
    },
  });

  // Coming back with the browser's Back button may restore this page as it was left (bfcache).
  useEffect(() => {
    const onPageShow = (pageEvent: PageTransitionEvent) => {
      if (pageEvent.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const checkout = useMutation({
    mutationFn: () => createOrder(hold.id),
    onSuccess: (order) => {
      queryClient.setQueryData(orderQueries.order(order.id).queryKey, order);
      void queryClient.invalidateQueries({ queryKey: [...orderQueries.all, 'list'] });
      if (order.paymentUrl === null) {
        // A free order: nothing to pay, it is confirmed in the background.
        void navigate(`/orders/${order.id}`);
        return;
      }
      setRedirecting(true);
      browserLocation.assign(order.paymentUrl);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'HOLD_EXPIRED') {
        onExpire();
      } else if (error.code === 'EMAIL_NOT_VERIFIED') {
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      } else if (error.code === 'EVENT_NOT_ON_SALE') {
        void queryClient.invalidateQueries({
          queryKey: catalogueQueries.event(event.slug).queryKey,
        });
      } else if (error.status === 404) {
        // The hold is gone: released in another tab, or already paid for.
        void queryClient.invalidateQueries({
          queryKey: seatQueries.currentHold(event.id).queryKey,
        });
      }
    },
  });

  const verified = session?.user.emailVerified ?? false;
  const busy = checkout.isPending || redirecting;
  const free = hold.totalCents === 0;

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="checkout-tickets-heading" className="flex flex-col gap-4">
        <h2 id="checkout-tickets-heading" className="text-xl font-semibold">
          Your tickets
        </h2>
        <HeldTickets
          items={hold.items}
          totalCents={hold.totalCents}
          label="Tickets in this order"
          tone="slate"
        />
      </section>
      <section
        aria-labelledby="checkout-payment-heading"
        className="flex flex-col gap-4 self-start rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-slate-700"
      >
        <h2 id="checkout-payment-heading" className="text-lg font-semibold text-slate-900">
          {free ? 'Confirm your order' : 'Payment'}
        </h2>
        <TimeLeft seconds={left} label="Time left to pay" />
        <p className="text-sm">
          {free
            ? 'These tickets are free. Confirm the order before the timer runs out.'
            : 'You pay on our payment provider’s page, then come back here. Pay before the timer runs out, or the tickets are released.'}
        </p>
        {checkout.isError && <FormAlert>{errorMessage(checkout.error, CHECKOUT_ERRORS)}</FormAlert>}
        {verified ? (
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) checkout.mutate();
            }}
            className="rounded-md bg-indigo-700 px-5 py-2.5 font-semibold text-white hover:bg-indigo-800 aria-disabled:cursor-wait aria-disabled:opacity-70"
          >
            {redirecting
              ? 'Opening the payment page…'
              : checkout.isPending
                ? 'Checking out…'
                : free
                  ? 'Confirm order'
                  : `Pay ${formatPrice(hold.totalCents)}`}
          </button>
        ) : (
          session !== undefined &&
          session !== null && (
            <div className="flex flex-col gap-3 border-t border-emerald-300 pt-4">
              <h3 className="font-semibold text-slate-900">Verify your email address</h3>
              <p className="text-sm">
                We sent a verification link to {session.user.email}. Verify your address, then come
                back to check out: your tickets stay held until the timer runs out.
              </p>
              <ResendVerification email={session.user.email} />
            </div>
          )
        )}
      </section>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
