/**
 * Warms React Query for finished-race mode so tabs open from cache instead of cold-fetching.
 * Run once at bootstrap; failures are non-fatal (individual screens still fetch).
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { history, live, telemetry } from '../lib/api';
import { isHistoricalOnly } from '../lib/config';
import {
  finishedDefaultSessionQueryKey,
  FINISHED_DEFAULT_SESSION_STALE_MS,
} from '../lib/finishedSessionQuery';

const RACE_REPORT_STALE_MS = 10 * 60 * 1000;
const LIVE_LIST_STALE_MS = 5 * 60 * 1000;

export function HistoricalDataPrefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isHistoricalOnly()) return;

    let cancelled = false;

    async function warm() {
      const fdKey = [...finishedDefaultSessionQueryKey()];
      let fd: Awaited<ReturnType<typeof history.finishedDefaultSession>>;
      try {
        fd = await queryClient.fetchQuery({
          queryKey: fdKey,
          queryFn: () => history.finishedDefaultSession(),
          staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
        });
      } catch {
        return;
      }
      if (cancelled || !fd) return;

      const y = String(fd.year);
      const r = String(fd.round);
      const sk = fd.session_key;
      const seasonYear = fd.year;
      const raceName = fd.meeting_name ?? '';

      const tasks: Promise<unknown>[] = [
        queryClient.prefetchQuery({
          queryKey: ['race_report', y, r],
          queryFn: () => history.raceReport(y, r),
          staleTime: RACE_REPORT_STALE_MS,
        }),
        queryClient.prefetchQuery({
          queryKey: ['schedule', String(seasonYear)],
          queryFn: () => history.schedule(seasonYear),
          staleTime: 60 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['season_overview', String(seasonYear)],
          queryFn: () => history.seasonOverview(seasonYear),
          staleTime: 60 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['ergast_drivers', seasonYear],
          queryFn: () => history.drivers(seasonYear),
          staleTime: 60 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['lap_evolution', y, r],
          queryFn: () => history.lapEvolution(y, r),
          staleTime: 10 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['drivers', sk],
          queryFn: () => live.drivers(sk),
          staleTime: LIVE_LIST_STALE_MS,
        }),
        queryClient.prefetchQuery({
          queryKey: ['stints', sk],
          queryFn: () => live.stints(sk),
          staleTime: LIVE_LIST_STALE_MS,
        }),
        queryClient.prefetchQuery({
          queryKey: ['laps_for_count', sk],
          queryFn: () => live.laps(sk),
          staleTime: LIVE_LIST_STALE_MS,
        }),
        queryClient.prefetchQuery({
          queryKey: ['pits', sk],
          queryFn: () => live.pits(sk),
          staleTime: LIVE_LIST_STALE_MS,
        }),
        queryClient.prefetchQuery({
          queryKey: ['track_path', sk],
          queryFn: () => live.trackPath(sk),
          staleTime: 10 * 60 * 1000,
        }),
        queryClient.prefetchQuery({
          queryKey: ['circuit_map', y, r, raceName ?? ''],
          queryFn: () => telemetry.circuitMap(y, r, raceName || undefined),
          staleTime: Infinity,
        }),
        queryClient.prefetchQuery({
          queryKey: ['race_results', y, r],
          queryFn: () => history.raceResults(y, r),
          staleTime: 10 * 60 * 1000,
        }),
      ];

      await Promise.allSettled(tasks);

      if (cancelled) return;

      try {
        const roster = await queryClient.fetchQuery({
          queryKey: ['drivers', sk],
          queryFn: () => live.drivers(sk),
          staleTime: LIVE_LIST_STALE_MS,
        });
        const first = Array.isArray(roster) ? roster[0] : undefined;
        const num = first?.driver_number;
        if (typeof num === 'number' && num > 0) {
          await queryClient.prefetchQuery({
            queryKey: ['laps', sk, num],
            queryFn: () => live.laps(sk, num),
            staleTime: LIVE_LIST_STALE_MS,
          });
        }
      } catch {
        /* optional */
      }
    }

    void warm();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  return null;
}
