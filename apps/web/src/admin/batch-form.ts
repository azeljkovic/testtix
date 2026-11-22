import { BATCH_EMPTY_MESSAGE, LOCALE, type SectionType } from '@testtix/shared';

import type { AdminEvent, AdminVenue } from '../api/admin.js';
import {
  type Conversion,
  type FormatErrors,
  parseIntegerInput,
} from '../forms/request-resolver.js';
import { EVENT_FORM_MESSAGES } from './event-form.js';
import { parsePrice } from './money-input.js';
import { fromZonedLocal } from './zoned-time.js';

/** A section of the event's venue, with the tickets no batch has released yet. */
export interface BatchSection {
  id: string;
  name: string;
  type: SectionType;
  capacity: number;
  unreleased: number;
}

/** The release form: seated sections are released whole, GA sections by quantity. */
export interface BatchFormValues {
  name: string;
  price: string;
  releasesAt: string;
  /** In the venue's section order. `selected` applies to seated sections, `quantity` to GA ones. */
  sections: { sectionId: string; selected: boolean; quantity: string }[];
}

export const BATCH_FORM_MESSAGES = {
  quantityFormat: 'Enter a whole number of places',
  quantityMin: 'Release at least 1 place, or leave it empty',
  quantityMax: (unreleased: number) =>
    `Only ${unreleased.toLocaleString(LOCALE)} ${unreleased === 1 ? 'place is' : 'places are'} left to release`,
  empty: BATCH_EMPTY_MESSAGE,
} as const;

/** The venue's sections with what the event's batches have released of each. */
export function batchSections(venue: AdminVenue, event: AdminEvent): BatchSection[] {
  const released = new Map<string, number>();
  for (const batch of event.batches) {
    for (const section of batch.sections) {
      released.set(
        section.sectionId,
        (released.get(section.sectionId) ?? 0) + section.tickets.total,
      );
    }
  }
  return venue.sections.map((section) => ({
    id: section.id,
    name: section.name,
    type: section.type,
    capacity: section.capacity,
    unreleased: section.capacity - (released.get(section.id) ?? 0),
  }));
}

export function batchFormValues(sections: BatchSection[]): BatchFormValues {
  return {
    name: '',
    price: '',
    releasesAt: '',
    sections: sections.map((section) => ({ sectionId: section.id, selected: false, quantity: '' })),
  };
}

/** Builds the release request. Times are in the venue's time zone. */
export function convertBatchForm(
  values: BatchFormValues,
  sections: BatchSection[],
  timeZone: string,
): Conversion {
  const errors: FormatErrors = {};

  const price = parsePrice(values.price);
  if (!price.ok) errors.price = price.message;

  let releasesAt: string | undefined;
  if (values.releasesAt !== '') {
    const result = fromZonedLocal(values.releasesAt, timeZone);
    if (result.ok) releasesAt = result.iso;
    else {
      errors.releasesAt =
        result.reason === 'skipped'
          ? EVENT_FORM_MESSAGES.skippedTime(timeZone)
          : EVENT_FORM_MESSAGES.invalidTime;
    }
  }

  const seatedSectionIds: string[] = [];
  const gaSections: { sectionId: string; quantity: number }[] = [];
  values.sections.forEach((row, index) => {
    const section = sections.find(({ id }) => id === row.sectionId);
    if (section === undefined) return;
    if (section.type === 'SEATED') {
      if (row.selected) seatedSectionIds.push(section.id);
      return;
    }
    const quantity = parseIntegerInput(row.quantity);
    if (quantity === undefined) return;
    const path = `sections.${String(index)}.quantity`;
    if (Number.isNaN(quantity)) errors[path] = BATCH_FORM_MESSAGES.quantityFormat;
    else if (quantity < 1) errors[path] = BATCH_FORM_MESSAGES.quantityMin;
    else if (quantity > section.unreleased) {
      errors[path] = BATCH_FORM_MESSAGES.quantityMax(section.unreleased);
    } else {
      gaSections.push({ sectionId: section.id, quantity });
    }
  });
  // A quantity with an error is left out; its own message says what's wrong.
  const quantityError = Object.keys(errors).some((path) => path.startsWith('sections.'));
  if (!quantityError && seatedSectionIds.length === 0 && gaSections.length === 0) {
    errors.sections = BATCH_FORM_MESSAGES.empty;
  }

  return {
    request: {
      name: values.name,
      // A placeholder price keeps the schema from repeating the price error with its own wording.
      priceCents: price.ok ? price.cents : 0,
      ...(releasesAt === undefined ? {} : { releasesAt }),
      ...(seatedSectionIds.length > 0 ? { seatedSectionIds } : {}),
      ...(gaSections.length > 0 ? { gaSections } : {}),
    },
    errors,
  };
}
