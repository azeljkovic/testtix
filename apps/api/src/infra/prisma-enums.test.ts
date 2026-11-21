import {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  INVENTORY_STATUSES,
  ORDER_STATUSES,
  ROLES,
  SECTION_TYPES,
} from '@testtix/shared';
import { describe, expect, it } from 'vitest';

import {
  EventCategory,
  EventStatus,
  InventoryStatus,
  OrderStatus,
  Role,
  SectionType,
} from '../generated/prisma/enums.js';

// The database and the API contract must agree on every enum value (tech-stack §3).
describe.each([
  ['Role', Role, ROLES],
  ['EventCategory', EventCategory, EVENT_CATEGORIES],
  ['EventStatus', EventStatus, EVENT_STATUSES],
  ['SectionType', SectionType, SECTION_TYPES],
  ['InventoryStatus', InventoryStatus, INVENTORY_STATUSES],
  ['OrderStatus', OrderStatus, ORDER_STATUSES],
] as const)('Prisma enum %s', (_name, prismaEnum, shared) => {
  it('has the same values, in the same order, as @testtix/shared', () => {
    expect(Object.values(prismaEnum)).toEqual(shared);
  });
});
