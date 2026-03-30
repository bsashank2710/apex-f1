/**
 * Aligns OpenF1 session_key across tabs: "latest" in the picker is not the same as
 * GET /session vs GET /map_session (FP1 vs race, between-session gaps). Live Map and
 * Race Hub already follow map_session; lap log and stints must use the same key.
 *
 * For "latest", we **do not** fall back to GET /session while map_session is loading —
 * that pointed Tyres / Lap Log / Telemetry at the wrong meeting (then flipped when
 * map_session arrived), which felt like stale data and empty tables.
 *
 * Historical mode: map_session is not polled. "latest" must still resolve to a numeric
 * session key via GET /history/finished_default_session — otherwise effectiveKey stays null
 * and Tyres / Lap Log / Telemetry / Drivers never load.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { live, history } from '../lib/api';
import {
  finishedDefaultSessionQueryKey,
  FINISHED_DEFAULT_SESSION_STALE_MS,
} from '../lib/finishedSessionQuery';
import { isHistoricalOnly } from '../lib/config';
import { useRaceStore } from '../store/raceStore';

export type OpenF1EffectiveKey = number | 'latest' | null;

export function useOpenF1LiveContext() {
  const selectedSessionKey = useRaceStore((s) => s.selectedSessionKey);
  const selectedSessionInfo = useRaceStore((s) => s.selectedSessionInfo);

  const isPending = selectedSessionKey === 'pending';
  const pollLatest =
    selectedSessionKey === 'latest' && !isHistoricalOnly();

  const {
    data: mapFocus,
    isFetched: mapSessionFetched,
    isError: mapSessionError,
    error: mapSessionErr,
    refetch: refetchMapSession,
  } = useQuery({
    queryKey: ['map_session'],
    queryFn: () => live.mapSession(),
    enabled: pollLatest,
    refetchInterval: pollLatest ? 12_000 : false,
    staleTime: 4000,
    refetchOnWindowFocus: pollLatest,
    refetchOnReconnect: pollLatest,
    retry: 1,
  });

  const { data: liveSession } = useQuery({
    queryKey: ['session'],
    queryFn: () => live.session(),
    enabled: pollLatest,
    refetchInterval: pollLatest ? 25_000 : false,
    staleTime: 15_000,
  });

  const { data: finishedDefaultFeed } = useQuery({
    queryKey: [...finishedDefaultSessionQueryKey()],
    queryFn: () => history.finishedDefaultSession(),
    enabled:
      isHistoricalOnly()
      && (selectedSessionKey === 'latest' || selectedSessionKey === 'pending'),
    staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
  });

  const effectiveKey: OpenF1EffectiveKey = useMemo(() => {
    /** Default session can be prefetched before Zustand leaves `pending` — still bind tabs to it. */
    if (isPending) {
      return finishedDefaultFeed?.session_key != null
        ? finishedDefaultFeed.session_key
        : null;
    }
    if (selectedSessionKey !== 'latest') {
      return selectedSessionKey;
    }
    if (pollLatest) {
      return mapSessionFetched
        ? (mapFocus?.session_key != null ? mapFocus.session_key : 'latest')
        : null;
    }
    if (finishedDefaultFeed?.session_key != null) {
      return finishedDefaultFeed.session_key;
    }
    return null;
  }, [
    isPending,
    selectedSessionKey,
    pollLatest,
    mapSessionFetched,
    mapFocus?.session_key,
    finishedDefaultFeed?.session_key,
  ]);

  /** Tyres / stints are not published for typical quali & practice sessions in OpenF1. */
  const sessionLikelyHasStints = (() => {
    let raw: string | undefined;
    if (selectedSessionKey === 'latest') {
      if (pollLatest) {
        raw = mapFocus?.session_name;
      } else {
        raw = finishedDefaultFeed?.session_name ?? mapFocus?.session_name;
      }
    } else if (selectedSessionKey === 'pending') {
      raw = finishedDefaultFeed?.session_name;
    } else {
      raw = selectedSessionInfo?.session_name;
    }
    const n = (raw ?? '').toLowerCase();
    if (!n) return true;
    if (n.includes('qualifying') || n.includes('practice') || /\bfp\d?\b/.test(n)) return false;
    return true;
  })();

  return {
    selectedSessionKey,
    mapFocus,
    liveSession,
    effectiveKey,
    /** false when we have no session key yet (e.g. still resolving default session). */
    openF1KeyReady: effectiveKey !== null,
    sessionLikelyHasStints,
    mapSessionFetched,
    mapSessionError,
    mapSessionErr,
    refetchMapSession,
  };
}
