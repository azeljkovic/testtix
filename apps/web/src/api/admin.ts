import type {
  CreateEventRequest,
  CreateVenueRequest,
  ReleaseBatchRequest,
  UpdateEventRequest,
  UpdateVenueRequest,
} from '@testtix/shared';

import { api, csrfHeader } from './client.js';
import { unwrap } from './errors.js';
import type { components, operations } from './generated/openapi.js';

export type AdminEventSummary = components['schemas']['AdminEventSummary_Output'];
export type AdminEventVenue = components['schemas']['AdminEventVenue_Output'];
export type AdminEvent = components['schemas']['AdminEvent_Output'];
export type AdminEventPage = components['schemas']['AdminEventPage_Output'];
export type AdminBatch = components['schemas']['AdminBatch_Output'];
export type AdminVenueSummary = components['schemas']['AdminVenueSummary_Output'];
export type AdminVenue = components['schemas']['AdminVenue_Output'];
export type AdminVenuePage = components['schemas']['AdminVenuePage_Output'];
export type TicketCounts = components['schemas']['TicketCounts_Output'];

export type AdminEventListQuery = NonNullable<
  operations['AdminEventsController_list']['parameters']['query']
>;
export type AdminVenueListQuery = NonNullable<
  operations['AdminVenuesController_list']['parameters']['query']
>;

/** A status change of an event: `POST /admin/events/{eventId}/<action>`. */
export type EventAction = 'publish' | 'unpublish' | 'cancel';

// Events

export async function fetchAdminEvents(
  query: AdminEventListQuery,
  signal?: AbortSignal,
): Promise<AdminEventPage> {
  return unwrap(await api.GET('/admin/events', { params: { query }, signal }));
}

export async function fetchAdminEvent(eventId: string, signal?: AbortSignal): Promise<AdminEvent> {
  return unwrap(
    await api.GET('/admin/events/{eventId}', { params: { path: { eventId } }, signal }),
  );
}

export async function createEvent(body: CreateEventRequest): Promise<AdminEvent> {
  return unwrap(await api.POST('/admin/events', { params: { header: await csrfHeader() }, body }));
}

export async function updateEvent(eventId: string, body: UpdateEventRequest): Promise<AdminEvent> {
  return unwrap(
    await api.PATCH('/admin/events/{eventId}', {
      params: { path: { eventId }, header: await csrfHeader() },
      body,
    }),
  );
}

export async function deleteEvent(eventId: string): Promise<void> {
  unwrap(
    await api.DELETE('/admin/events/{eventId}', {
      params: { path: { eventId }, header: await csrfHeader() },
    }),
  );
}

export async function changeEventStatus(eventId: string, action: EventAction): Promise<AdminEvent> {
  const params = { path: { eventId }, header: await csrfHeader() };
  switch (action) {
    case 'publish':
      return unwrap(await api.POST('/admin/events/{eventId}/publish', { params }));
    case 'unpublish':
      return unwrap(await api.POST('/admin/events/{eventId}/unpublish', { params }));
    case 'cancel':
      return unwrap(await api.POST('/admin/events/{eventId}/cancel', { params }));
  }
}

export async function releaseBatch(
  eventId: string,
  body: ReleaseBatchRequest,
): Promise<AdminBatch> {
  return unwrap(
    await api.POST('/admin/events/{eventId}/batches', {
      params: { path: { eventId }, header: await csrfHeader() },
      body,
    }),
  );
}

// Venues

export async function fetchAdminVenues(
  query: AdminVenueListQuery,
  signal?: AbortSignal,
): Promise<AdminVenuePage> {
  return unwrap(await api.GET('/admin/venues', { params: { query }, signal }));
}

export async function fetchAdminVenue(venueId: string, signal?: AbortSignal): Promise<AdminVenue> {
  return unwrap(
    await api.GET('/admin/venues/{venueId}', { params: { path: { venueId } }, signal }),
  );
}

export async function createVenue(body: CreateVenueRequest): Promise<AdminVenue> {
  return unwrap(await api.POST('/admin/venues', { params: { header: await csrfHeader() }, body }));
}

export async function updateVenue(venueId: string, body: UpdateVenueRequest): Promise<AdminVenue> {
  return unwrap(
    await api.PATCH('/admin/venues/{venueId}', {
      params: { path: { venueId }, header: await csrfHeader() },
      body,
    }),
  );
}

export async function deleteVenue(venueId: string): Promise<void> {
  unwrap(
    await api.DELETE('/admin/venues/{venueId}', {
      params: { path: { venueId }, header: await csrfHeader() },
    }),
  );
}
