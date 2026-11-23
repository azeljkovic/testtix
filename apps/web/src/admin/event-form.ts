import type { CreateEventRequest, EventCategory, UpdateEventRequest } from '@testtix/shared';

import type { AdminEvent } from '../api/admin.js';
import {
  type Conversion,
  type FormatErrors,
  optionalText,
  parseIntegerInput,
} from '../forms/request-resolver.js';
import { fromZonedLocal, toZonedLocal } from './zoned-time.js';

/** The event form's values: text as typed, times as wall-clock times at the venue. */
export interface EventFormValues {
  title: string;
  slug: string;
  performer: string;
  description: string;
  category: EventCategory;
  venueId: string;
  startsAt: string;
  endsAt: string;
  salesOpenAt: string;
  holdDurationSec: string;
  maxTicketsPerOrder: string;
  waitingRoomEnabled: boolean;
  admissionRatePerSec: string;
  admissionTokenTtlSec: string;
}

const TIME_FIELDS = ['startsAt', 'endsAt', 'salesOpenAt'] as const;

export const EVENT_FORM_MESSAGES = {
  venueFirst: 'Choose a venue first: times are in the venue’s time zone',
  invalidTime: 'Enter a date and time',
  skippedTime: (timeZone: string) =>
    `This time doesn’t exist in ${timeZone}: the clocks skip it. Choose another time.`,
} as const;

/** Empty values for a new event, or the values of `event` to edit it. */
export function eventFormValues(event?: AdminEvent): EventFormValues {
  if (event === undefined) {
    return {
      title: '',
      slug: '',
      performer: '',
      description: '',
      category: 'CONCERT',
      venueId: '',
      startsAt: '',
      endsAt: '',
      salesOpenAt: '',
      holdDurationSec: '',
      maxTicketsPerOrder: '',
      waitingRoomEnabled: false,
      admissionRatePerSec: '',
      admissionTokenTtlSec: '',
    };
  }
  const timeZone = event.venue.timezone;
  return {
    title: event.title,
    slug: event.slug,
    performer: event.performer,
    description: event.description,
    category: event.category,
    venueId: event.venue.id,
    startsAt: toZonedLocal(event.startsAt, timeZone),
    endsAt: toZonedLocal(event.endsAt, timeZone),
    salesOpenAt: toZonedLocal(event.salesOpenAt, timeZone),
    holdDurationSec: String(event.holdDurationSec),
    maxTicketsPerOrder: String(event.maxTicketsPerOrder),
    waitingRoomEnabled: event.waitingRoomEnabled,
    admissionRatePerSec: String(event.admissionRatePerSec),
    admissionTokenTtlSec: String(event.admissionTokenTtlSec),
  };
}

/**
 * Builds the create request from the form. `timeZone` is the chosen venue's (times are entered
 * in it); empty optional fields are left out, so the API applies its defaults. The waiting room
 * checkbox is always sent.
 */
export function convertEventForm(
  values: EventFormValues,
  timeZone: string | undefined,
): Conversion {
  const errors: FormatErrors = {};
  const times: Partial<Record<(typeof TIME_FIELDS)[number], string>> = {};
  for (const field of TIME_FIELDS) {
    const local = values[field];
    if (local === '') continue;
    if (timeZone === undefined) {
      errors[field] = EVENT_FORM_MESSAGES.venueFirst;
      continue;
    }
    const result = fromZonedLocal(local, timeZone);
    if (result.ok) times[field] = result.iso;
    else {
      errors[field] =
        result.reason === 'skipped'
          ? EVENT_FORM_MESSAGES.skippedTime(timeZone)
          : EVENT_FORM_MESSAGES.invalidTime;
    }
  }
  const request = {
    title: values.title,
    slug: optionalText(values.slug),
    performer: values.performer,
    description: values.description,
    category: values.category,
    venueId: values.venueId,
    ...times,
    holdDurationSec: parseIntegerInput(values.holdDurationSec),
    maxTicketsPerOrder: parseIntegerInput(values.maxTicketsPerOrder),
    // Always sent (a checkbox is never empty), so an edit can turn it off.
    waitingRoomEnabled: values.waitingRoomEnabled,
    admissionRatePerSec: parseIntegerInput(values.admissionRatePerSec),
    admissionTokenTtlSec: parseIntegerInput(values.admissionTokenTtlSec),
  };
  return { request: withoutUndefined(request), errors };
}

/** The fields of `request` that differ from `original`: the body of the update. */
export function changedEventFields(
  request: CreateEventRequest,
  original: CreateEventRequest,
): UpdateEventRequest {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request) as [keyof CreateEventRequest, unknown][]) {
    if (value !== original[key]) changes[key] = value;
  }
  return changes;
}

function withoutUndefined<T extends object>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
