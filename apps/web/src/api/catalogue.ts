import { api } from './client.js';
import { unwrap } from './errors.js';
import type { components, operations } from './generated/openapi.js';

export type CatalogueEventSummary = components['schemas']['CatalogueEventSummary_Output'];
export type CatalogueEvent = components['schemas']['CatalogueEvent_Output'];
export type CatalogueEventPage = components['schemas']['CatalogueEventPage_Output'];
export type CatalogueSection = components['schemas']['CatalogueSection_Output'];
export type CatalogueVenue = components['schemas']['CatalogueVenue_Output'];

/** The query parameters of `GET /events`, as the spec types them. */
export type EventListQuery = NonNullable<
  operations['CatalogueController_list']['parameters']['query']
>;

/** `GET /events`: one page of published events. */
export async function fetchEvents(
  query: EventListQuery,
  signal?: AbortSignal,
): Promise<CatalogueEventPage> {
  return unwrap(await api.GET('/events', { params: { query }, signal }));
}

/** `GET /events/{slug}`: one published event with its availability per section. */
export async function fetchEvent(slug: string, signal?: AbortSignal): Promise<CatalogueEvent> {
  return unwrap(await api.GET('/events/{slug}', { params: { path: { slug } }, signal }));
}

/** The most venues one `GET /venues` page returns: enough for the venue filter's choices. */
const VENUE_PAGE_SIZE = 100;

/** `GET /venues`: venues with published events, by name. */
export async function fetchVenues(signal?: AbortSignal): Promise<CatalogueVenue[]> {
  const page = unwrap(
    await api.GET('/venues', { params: { query: { pageSize: VENUE_PAGE_SIZE } }, signal }),
  );
  return page.items;
}
