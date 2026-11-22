import type { SectionInput } from '@testtix/shared';

import type { Prisma } from '../generated/prisma/client.js';

export interface VenueLayoutRows {
  sections: Prisma.SectionCreateManyInput[];
  seats: Prisma.SeatCreateManyInput[];
}

/**
 * The section and seat rows of a venue layout. Sections keep the given order (`sortOrder` 0, 1,
 * …). A seated section becomes a grid: rows lettered from the front (`A`, `B`, …, `Z`, `AA`) and
 * seats numbered from 1 in each row. GA sections get a capacity and no seats.
 */
export function buildVenueLayout(
  venueId: string,
  sections: readonly SectionInput[],
  newId: () => string,
): VenueLayoutRows {
  const rows: VenueLayoutRows = { sections: [], seats: [] };
  sections.forEach((section, sortOrder) => {
    const sectionId = newId();
    rows.sections.push({
      id: sectionId,
      venueId,
      name: section.name,
      type: section.type,
      capacity: section.type === 'GA' ? section.capacity : null,
      sortOrder,
    });
    if (section.type === 'GA') return;
    for (let rowIndex = 0; rowIndex < section.rows; rowIndex++) {
      const row = rowLabel(rowIndex);
      for (let number = 1; number <= section.seatsPerRow; number++) {
        rows.seats.push({ id: newId(), sectionId, row, rowIndex, number });
      }
    }
  });
  return rows;
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB". */
export function rowLabel(index: number): string {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(65 + (n % 26)) + label;
  }
  return label;
}
