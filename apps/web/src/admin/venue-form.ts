import type { SectionType } from '@testtix/shared';

import type { AdminVenue } from '../api/admin.js';
import { type Conversion, optionalText, parseIntegerInput } from '../forms/request-resolver.js';

/** One section row of the venue form. Only the size fields of its type are sent. */
export interface SectionFormValues {
  type: SectionType;
  name: string;
  rows: string;
  seatsPerRow: string;
  capacity: string;
}

export interface VenueFormValues {
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  sections: SectionFormValues[];
}

export function emptySection(type: SectionType): SectionFormValues {
  return { type, name: '', rows: '', seatsPerRow: '', capacity: '' };
}

/** Values for a new venue (one seated section to start from), or those of `venue` to edit it. */
export function venueFormValues(venue?: AdminVenue): VenueFormValues {
  if (venue === undefined) {
    return {
      name: '',
      slug: '',
      address: '',
      city: '',
      timezone: 'America/New_York',
      sections: [emptySection('SEATED')],
    };
  }
  return {
    name: venue.name,
    slug: venue.slug,
    address: venue.address,
    city: venue.city,
    timezone: venue.timezone,
    sections: venue.sections.map((section) => {
      if (section.type === 'GA') {
        return { ...emptySection('GA'), name: section.name, capacity: String(section.capacity) };
      }
      const rows = new Set(section.seats.map((seat) => seat.row)).size;
      return {
        ...emptySection('SEATED'),
        name: section.name,
        rows: String(rows),
        seatsPerRow: String(rows === 0 ? 0 : section.capacity / rows),
      };
    }),
  };
}

/** Builds the create request (or, for an update, the full set of fields) from the form. */
export function convertVenueForm(values: VenueFormValues): Conversion {
  return {
    request: {
      name: values.name,
      ...(optionalText(values.slug) === undefined ? {} : { slug: optionalText(values.slug) }),
      address: values.address,
      city: values.city,
      timezone: values.timezone,
      sections: values.sections.map((section) =>
        section.type === 'GA'
          ? { type: 'GA', name: section.name, capacity: parseIntegerInput(section.capacity) }
          : {
              type: 'SEATED',
              name: section.name,
              rows: parseIntegerInput(section.rows),
              seatsPerRow: parseIntegerInput(section.seatsPerRow),
            },
      ),
    },
    errors: {},
  };
}
