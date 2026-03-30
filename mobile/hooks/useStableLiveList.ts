import { useRef } from 'react';

/**
 * While polling OpenF1 during a live session, an occasional refetch can return an
 * empty array even though the feed still has data. React Query then replaces the
 * cache and the UI flashes “no data”. Hold the last non-empty snapshot for the
 * same session key until a new non-empty payload arrives (or the user leaves live
 * / changes session).
 */
export function useStableLiveList<T>(
  sessionId: string | number | null,
  pollLive: boolean,
  data: T[] | undefined,
): T[] | undefined {
  const idRef = useRef(sessionId);
  const snapRef = useRef<T[] | null>(null);

  if (idRef.current !== sessionId) {
    idRef.current = sessionId;
    snapRef.current = null;
  }

  if (data != null && data.length > 0) {
    snapRef.current = data;
    return data;
  }

  if (pollLive && sessionId != null && snapRef.current != null && snapRef.current.length > 0) {
    return snapRef.current;
  }

  return data;
}
