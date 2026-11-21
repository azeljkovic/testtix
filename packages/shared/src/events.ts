import { z } from 'zod';

/** What kind of event it is. Filterable in the catalogue (C2.2). */
export const EVENT_CATEGORIES = ['CONCERT', 'TALK', 'MEETUP'] as const;

export const EventCategorySchema = z.enum(EVENT_CATEGORIES).meta({ id: 'EventCategory' });

export type EventCategory = z.infer<typeof EventCategorySchema>;

/**
 * Event lifecycle (C2.1):
 *
 * - `DRAFT`: being set up by an admin; not visible in the public catalogue.
 * - `PUBLISHED`: visible in the catalogue; tickets sell once sales open and a batch is released.
 * - `CANCELLED`: no longer on sale; stays visible to people who bought tickets.
 */
export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;

export const EventStatusSchema = z.enum(EVENT_STATUSES).meta({ id: 'EventStatus' });

export type EventStatus = z.infer<typeof EventStatusSchema>;
