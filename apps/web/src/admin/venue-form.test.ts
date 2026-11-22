import { describe, expect, it } from 'vitest';

import { adminRiverside } from '../testing/admin-fixtures.js';
import { convertVenueForm, venueFormValues } from './venue-form.js';

describe('venue form', () => {
  it('reads a seated section’s grid back from its seats', () => {
    expect(venueFormValues(adminRiverside).sections).toEqual([
      { type: 'SEATED', name: 'Stalls', rows: '2', seatsPerRow: '3', capacity: '' },
      { type: 'SEATED', name: 'Balcony', rows: '1', seatsPerRow: '4', capacity: '' },
      { type: 'GA', name: 'Floor', rows: '', seatsPerRow: '', capacity: '50' },
    ]);
  });

  it('sends only the size fields of each section’s type', () => {
    const values = venueFormValues();
    values.sections = [
      { type: 'GA', name: 'Floor', rows: '3', seatsPerRow: '4', capacity: '200' },
      { type: 'SEATED', name: 'Stalls', rows: '3', seatsPerRow: '4', capacity: '200' },
    ];
    expect(convertVenueForm(values).request).toMatchObject({
      sections: [
        { type: 'GA', name: 'Floor', capacity: 200 },
        { type: 'SEATED', name: 'Stalls', rows: 3, seatsPerRow: 4 },
      ],
    });
  });
});
