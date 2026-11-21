import { z } from 'zod';

/**
 * How a venue section sells:
 *
 * - `SEATED`: every ticket is a specific seat (row and number).
 * - `GA`: general admission; tickets are places in the section, up to its capacity.
 */
export const SECTION_TYPES = ['SEATED', 'GA'] as const;

export const SectionTypeSchema = z.enum(SECTION_TYPES).meta({ id: 'SectionType' });

export type SectionType = z.infer<typeof SectionTypeSchema>;

/**
 * State of one sellable ticket (a seat, or a place in a GA section) for an event (C3.1):
 *
 * - `AVAILABLE`: can be held.
 * - `HELD`: claimed by a customer's hold until `heldUntil`. Once that time passes, the unit counts
 *   as available again, even before the sweeper (C3.2) resets it.
 * - `SOLD`: part of a confirmed order.
 */
export const INVENTORY_STATUSES = ['AVAILABLE', 'HELD', 'SOLD'] as const;

export const InventoryStatusSchema = z.enum(INVENTORY_STATUSES).meta({ id: 'InventoryStatus' });

export type InventoryStatus = z.infer<typeof InventoryStatusSchema>;
