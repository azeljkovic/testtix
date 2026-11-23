import { useQuery } from '@tanstack/react-query';

import type { CatalogueEvent } from '../api/catalogue.js';
import { useSession } from '../auth/session.js';
import { queueQueries } from './queries.js';

/** The waiting room page of a ticket drop. */
export function queuePath(slug: string): string {
  return `/events/${slug}/queue`;
}

/** Whether the seat map and holds of an event may be used, and with which admission token. */
export type Admission =
  /** Not a ticket drop: no token needed. */
  | { state: 'open'; token: null }
  /** Still finding out (the event, the session or the queue entry is loading). */
  | { state: 'checking'; token: null }
  /** A ticket drop, and you aren't let in (or aren't logged in): go to the waiting room. */
  | { state: 'queue'; token: null }
  /** Let in until `expiresAt` (server clock). */
  | { state: 'admitted'; token: string; expiresAt: string };

/**
 * Your admission to `event`'s seat map and holds. For a ticket drop (`waitingRoomEnabled`) it reads
 * your queue entry (`queueQueries.entry()`), which joins the queue if you aren't in it: so after a
 * reload you're let straight back in while your admission lasts.
 */
export function useAdmission(event: CatalogueEvent | undefined): Admission {
  const drop = event?.waitingRoomEnabled === true;
  const session = useSession();
  const loggedIn = session.data !== undefined && session.data !== null;
  const entry = useQuery({
    ...queueQueries.entry(event?.id ?? ''),
    enabled: drop && loggedIn,
  });

  if (event === undefined) return { state: 'checking', token: null };
  if (!drop) return { state: 'open', token: null };
  if (session.data === null) return { state: 'queue', token: null };
  const admission = entry.data?.status === 'ADMITTED' ? entry.data.admission : null;
  if (admission !== null) {
    return { state: 'admitted', token: admission.token, expiresAt: admission.expiresAt };
  }
  if (entry.data !== undefined || entry.isError) return { state: 'queue', token: null };
  return { state: 'checking', token: null };
}
