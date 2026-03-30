/**
 * Warms React Query cache for finished-race mode so tabs open with data already in memory.
 * Call once at app bootstrap (non-blocking).
 */

import type { QueryClient } from '@tanstack/react-query';
import { live, history, telemetry } from './api';
import type { FinishedDefaultSession } from './api';
import {
  finishedDefaultSessionQueryKey,
  FINISHED_DEFAULT_SESSION_STALE_MS,
} from './finishedSessionQuery';
import { isHistoricalOnly } from './config';

export async function prefetchHistoricalAppData(queryClient: QueryClient): Promise<void> {
  if (!isHistoricalOnly()) return;

  const fdKey = [...finishedDefaultSessionQueryKey()];
  let fd = queryClient.getQueryData<FinishedDefaultSession>(fdKey);
  if (!fd?.session_key) {
    try {
      await queryClient.prefetchQuery({
        queryKey: fdKey,
        queryFn: () => history.finishedDefaultSession(),
        staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
      });
    } catch {
      return;
    }
    fd = queryClient.getQueryData<FinishedDefaultSession>(fdKey);
  }
  if (!fd?.session_key) return;

  const y = String(fd.year);
  const r = String(fd.round);
  const sk = fd.session_key;
  /** Same 4th segment as LiveMap `raceName` (Ergast raceName / finished default meeting_name). */
  const raceNameForMap = fd.meeting_name;
  const seasonYear = new Date().getFullYear();

  const staleLong = 60 * 60 * 1000;
  const staleMed = 10 * 60 * 1000;

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ['race_report', y, r],
      queryFn: () => history.raceReport(y, r),
      staleTime: staleMed,
    }),
    queryClient.prefetchQuery({
      queryKey: ['schedule', y],
      queryFn: () => history.schedule(y),
      staleTime: staleLong,
    }),
    queryClient.prefetchQuery({
      queryKey: ['season_overview', seasonYear],
      queryFn: () => history.seasonOverview(seasonYear),
      staleTime: staleLong,
    }),
    queryClient.prefetchQuery({
      queryKey: ['ergast_drivers', seasonYear],
      queryFn: () => history.drivers(seasonYear),
      staleTime: staleLong,
    }),
    queryClient.prefetchQuery({
      queryKey: ['stints', sk],
      queryFn: () => live.stints(sk),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['drivers', sk],
      queryFn: () => live.drivers(sk),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['laps_for_count', sk],
      queryFn: () => live.laps(sk),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['laps', sk, null],
      queryFn: () => live.laps(sk),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['pits', sk],
      queryFn: () => live.pits(sk),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: ['track_path', sk],
      queryFn: () => live.trackPath(sk),
      staleTime: staleMed,
    }),
    queryClient.prefetchQuery({
      queryKey: ['lap_evolution', y, r],
      queryFn: () => history.lapEvolution(y, r),
      staleTime: staleMed,
    }),
    queryClient.prefetchQuery({
      queryKey: ['race_results', y, r],
      queryFn: () => history.raceResults(y, r),
      staleTime: staleMed,
    }),
    queryClient.prefetchQuery({
      queryKey: ['circuit_map', y, r, raceNameForMap],
      queryFn: () => telemetry.circuitMap(y, r, fd.meeting_name),
      staleTime: staleLong,
    }),
  ]);
}
