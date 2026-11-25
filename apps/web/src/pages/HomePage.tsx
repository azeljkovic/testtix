import type { EventCategory } from '@testtix/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { useSession } from '../auth/session.js';
import { EventCard } from '../catalogue/EventCard.js';
import { catalogueQueries } from '../catalogue/queries.js';
import { PageTitle } from '../layout/PageTitle.js';

/** How many on-sale events the home page shows. */
export const HOME_EVENT_COUNT = 3;

const PRIMARY_BUTTON =
  'inline-block rounded-md bg-indigo-700 px-5 py-3 font-semibold text-white shadow-sm hover:bg-indigo-800';
const SECONDARY_BUTTON =
  'inline-block rounded-md border border-indigo-200 bg-white px-5 py-3 font-semibold text-indigo-700 shadow-sm hover:border-indigo-400';
const LINK_CLASS = 'font-medium text-indigo-700 underline underline-offset-4';

export function HomePage() {
  return (
    <>
      <PageTitle />
      <Hero />
      <OnSaleNow />
      <Categories />
      <HowItWorks />
    </>
  );
}

function Hero() {
  const session = useSession();

  return (
    <section className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-linear-to-br from-indigo-50 via-white to-violet-100 px-6 py-12 sm:px-10 sm:py-16">
      <div className="grid items-center gap-10 md:grid-cols-[3fr_2fr]">
        <div>
          <p className="text-sm font-semibold tracking-wide text-indigo-700 uppercase">
            Concerts · Talks · Meetups
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Tickets for concerts, talks and meetups
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-slate-700">
            Pick your seats, hold them while you check out, and get your e-tickets by email.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/events" className={PRIMARY_BUTTON}>
              Browse events
            </Link>
            {/* Only once we know nobody is logged in, so the button doesn't flash for members. */}
            {session.data === null && (
              <Link to="/register" className={SECONDARY_BUTTON}>
                Create an account
              </Link>
            )}
          </div>
        </div>
        <TicketIllustration />
      </div>
    </section>
  );
}

/** Two overlapping tickets. Decorative: the heading says what the page is. */
function TicketIllustration() {
  return (
    <svg
      viewBox="0 0 320 240"
      aria-hidden="true"
      className="mx-auto hidden w-full max-w-xs md:block"
      fill="none"
    >
      <g transform="rotate(-8 160 120)">
        <Ticket className="text-violet-200" stub="text-violet-300" />
      </g>
      <g transform="translate(14 22) rotate(6 160 120)">
        <Ticket className="text-indigo-700" stub="text-indigo-500" />
        <g className="text-white" fill="currentColor">
          <rect x="62" y="82" width="120" height="12" rx="6" />
          <rect x="62" y="104" width="84" height="8" rx="4" opacity="0.7" />
          <rect x="62" y="122" width="100" height="8" rx="4" opacity="0.7" />
          <rect x="62" y="150" width="48" height="16" rx="8" opacity="0.9" />
        </g>
        <g className="text-white" fill="currentColor" opacity="0.85">
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) =>
              (row + col) % 2 === 0 || (row === 1 && col === 1) ? (
                <rect
                  key={`${String(row)}-${String(col)}`}
                  x={226 + col * 12}
                  y={102 + row * 12}
                  width="10"
                  height="10"
                  rx="2"
                />
              ) : null,
            ),
          )}
        </g>
      </g>
    </svg>
  );
}

/** A ticket shape with notches and a perforated stub, filled with `currentColor`. */
function Ticket({ className, stub }: { className: string; stub: string }) {
  return (
    <>
      <path
        className={className}
        fill="currentColor"
        d="M48 60h224a12 12 0 0 1 12 12v30a18 18 0 0 0 0 36v30a12 12 0 0 1-12 12H48a12 12 0 0 1-12-12v-30a18 18 0 0 0 0-36V72a12 12 0 0 1 12-12Z"
      />
      <path
        className={stub}
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="6 7"
        strokeLinecap="round"
        d="M206 72v96"
      />
    </>
  );
}

/** The next few events with tickets on sale. */
function OnSaleNow() {
  const events = useQuery(
    catalogueQueries.events({
      availability: 'ON_SALE',
      sort: 'date',
      order: 'asc',
      pageSize: HOME_EVENT_COUNT,
    }),
  );

  return (
    <section aria-labelledby="on-sale-heading" className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="on-sale-heading" className="text-2xl font-bold tracking-tight">
          On sale now
        </h2>
        <Link to="/events?availability=ON_SALE" className={LINK_CLASS}>
          See all events on sale
        </Link>
      </div>
      {events.isPending ? (
        <>
          <p role="status" className="sr-only">
            Loading events…
          </p>
          <EventCardsSkeleton />
        </>
      ) : events.isError ? (
        <p className="mt-4 text-slate-700">
          We couldn’t load the events just now.{' '}
          <Link to="/events" className={LINK_CLASS}>
            Browse all events
          </Link>
        </p>
      ) : events.data.items.length === 0 ? (
        <p className="mt-4 text-slate-700">No events are on sale right now. Check back soon.</p>
      ) : (
        <ul aria-labelledby="on-sale-heading" className="mt-6 grid gap-4 md:grid-cols-3">
          {events.data.items.map((event) => (
            <li key={event.id}>
              <EventCard event={event} listSearch="" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Placeholder cards while the events load. Hidden from screen readers (the status says it). */
function EventCardsSkeleton() {
  return (
    <ul aria-hidden="true" className="mt-6 grid gap-4 md:grid-cols-3">
      {Array.from({ length: HOME_EVENT_COUNT }, (_, index) => (
        <li
          key={index}
          className="flex h-56 animate-pulse flex-col gap-3 rounded-lg border border-slate-200 p-5 motion-reduce:animate-none"
        >
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-6 w-3/4 rounded bg-slate-200" />
          <div className="h-4 w-1/2 rounded bg-slate-200" />
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="mt-auto h-5 w-1/4 rounded bg-slate-200" />
        </li>
      ))}
    </ul>
  );
}

const CATEGORIES: { category: EventCategory; title: string; text: string; icon: ReactNode }[] = [
  {
    category: 'CONCERT',
    title: 'Concerts',
    text: 'Reserved seats or standing room, from club nights to concert halls.',
    icon: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  },
  {
    category: 'TALK',
    title: 'Talks',
    text: 'Keynotes, lectures and panels. Choose a seat with a good view of the stage.',
    icon: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
      </>
    ),
  },
  {
    category: 'MEETUP',
    title: 'Meetups',
    text: 'Small, friendly get-togethers. Most are general admission, so just turn up.',
    icon: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9" />
      </>
    ),
  },
];

function Categories() {
  return (
    <section aria-labelledby="categories-heading" className="mt-16">
      <h2 id="categories-heading" className="text-2xl font-bold tracking-tight">
        Browse by category
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {CATEGORIES.map(({ category, title, text, icon }) => (
          <li
            key={category}
            className="relative flex h-full flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
              <Icon>{icon}</Icon>
            </span>
            <h3 className="text-lg font-semibold text-slate-900">
              <Link
                to={`/events?category=${category}`}
                // The link's ::after covers the card, so a click anywhere opens the list.
                className="after:absolute after:inset-0 after:content-['']"
              >
                {title}
              </Link>
            </h3>
            <p className="text-slate-700">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEPS = [
  {
    title: 'Pick your seats',
    text: 'Choose seats on the seat map, or how many standing tickets you need.',
  },
  {
    title: 'Hold them while you pay',
    text: 'Your tickets are held for you while you check out. A countdown shows the time left.',
  },
  {
    title: 'Get your e-tickets',
    text: 'Once payment goes through, your tickets arrive by email with a QR code each.',
  },
] as const;

function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-heading"
      className="mt-16 rounded-2xl bg-slate-50 px-6 py-10 sm:px-10"
    >
      <h2 id="how-it-works-heading" className="text-2xl font-bold tracking-tight">
        How it works
      </h2>
      <ol className="mt-6 grid gap-8 sm:grid-cols-3">
        {STEPS.map(({ title, text }, index) => (
          <li key={title} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-indigo-700 font-bold text-white"
            >
              {index + 1}
            </span>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="text-slate-700">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
