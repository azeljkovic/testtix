import { describe, expect, it } from 'vitest';

import {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  EventCategorySchema,
  EventStatusSchema,
} from './events.js';
import {
  INVENTORY_STATUSES,
  InventoryStatusSchema,
  SECTION_TYPES,
  SectionTypeSchema,
} from './inventory.js';
import { ORDER_STATUSES, OrderStatusSchema } from './orders.js';
import { PAYMENT_EVENT_OUTCOMES, PaymentEventOutcomeSchema } from './payments.js';
import { RoleSchema, ROLES } from './roles.js';

describe.each([
  ['RoleSchema', RoleSchema, ROLES],
  ['OrderStatusSchema', OrderStatusSchema, ORDER_STATUSES],
  ['EventCategorySchema', EventCategorySchema, EVENT_CATEGORIES],
  ['EventStatusSchema', EventStatusSchema, EVENT_STATUSES],
  ['SectionTypeSchema', SectionTypeSchema, SECTION_TYPES],
  ['InventoryStatusSchema', InventoryStatusSchema, INVENTORY_STATUSES],
  ['PaymentEventOutcomeSchema', PaymentEventOutcomeSchema, PAYMENT_EVENT_OUTCOMES],
] as const)('%s', (_name, schema, values) => {
  it.each(values)('accepts %s', (value) => {
    expect(schema.parse(value)).toBe(value);
  });

  it.each(['', 'unknown', values[0].toLowerCase()])('rejects %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
