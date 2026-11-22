import {
  type EventAvailability,
  type EventCategory,
  type EventSeating,
  formatPrice,
  LOCALE,
  type SectionType,
} from '@testtix/shared';

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  CONCERT: 'Concert',
  TALK: 'Talk',
  MEETUP: 'Meetup',
};

export const SEATING_LABELS: Record<EventSeating, string> = {
  SEATED: 'Reserved seating',
  GA: 'General admission',
  MIXED: 'Seated and standing',
};

export const AVAILABILITY_LABELS: Record<EventAvailability, string> = {
  ON_SALE: 'On sale',
  SOLD_OUT: 'Sold out',
  SALES_NOT_OPEN: 'Not on sale yet',
  SALES_ENDED: 'Sales ended',
};

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  SEATED: 'Seated',
  GA: 'General admission',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/**
 * An event time in the venue's time zone, e.g. "Sat, Dec 5, 2026, 8:00 PM EST": a visitor sees the
 * time printed on the ticket, wherever they are.
 */
export function formatEventDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { ...DATE_TIME_OPTIONS, timeZone }).format(new Date(iso));
}

/** An event's start and end in the venue's time zone, e.g. "Sat, Dec 5, 2026, 8:00 – 11:00 PM EST". */
export function formatEventTimeRange(startIso: string, endIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { ...DATE_TIME_OPTIONS, timeZone }).formatRange(
    new Date(startIso),
    new Date(endIso),
  );
}

/** A ticket price; 0 is "Free". */
export function formatTicketPrice(cents: number): string {
  return cents === 0 ? 'Free' : formatPrice(cents);
}

/** A price range, e.g. "$25.00 – $40.00", or a single price when every ticket costs the same. */
export function formatPriceRange({ minCents, maxCents }: { minCents: number; maxCents: number }) {
  return minCents === maxCents
    ? formatTicketPrice(minCents)
    : `${formatTicketPrice(minCents)} – ${formatTicketPrice(maxCents)}`;
}

/** "1 ticket", "3 tickets". */
export function ticketCount(count: number): string {
  return `${count.toLocaleString(LOCALE)} ${count === 1 ? 'ticket' : 'tickets'}`;
}
