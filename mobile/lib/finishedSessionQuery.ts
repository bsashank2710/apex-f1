/**
 * Shared React Query key for GET /history/finished_default_session.
 * Includes the calendar day (UTC) so stale “last race” cache cannot flash an old GP
 * (e.g. Japan) and then settle on a different round (e.g. China) after refetch.
 */
export function finishedDefaultSessionQueryKey(): readonly [
  'history',
  'finished_default_session',
  string,
] {
  return ['history', 'finished_default_session', new Date().toISOString().slice(0, 10)];
}

/**
 * Client cache TTL. The default session only changes when a new GP finishes; the key
 * already rotates at UTC midnight. Avoid staleTime:0 — it refetches on every tab focus
 * and makes the app feel slow.
 */
export const FINISHED_DEFAULT_SESSION_STALE_MS = 5 * 60 * 1000;
