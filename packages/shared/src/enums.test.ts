import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, OrderStatusSchema } from './orders.js';
import { RoleSchema, ROLES } from './roles.js';

describe.each([
  ['RoleSchema', RoleSchema, ROLES],
  ['OrderStatusSchema', OrderStatusSchema, ORDER_STATUSES],
] as const)('%s', (_name, schema, values) => {
  it.each(values)('accepts %s', (value) => {
    expect(schema.parse(value)).toBe(value);
  });

  it.each(['', 'unknown', values[0].toLowerCase()])('rejects %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
