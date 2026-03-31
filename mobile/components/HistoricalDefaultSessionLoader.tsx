/**
 * Resolves initial session in finished-race mode (EXPO_PUBLIC_HISTORICAL_ONLY).
 * Picks the last completed GP via GET /history/finished_default_session.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { history } from '../lib/api';
import {
  finishedDefaultSessionQueryKey,
  FINISHED_DEFAULT_SESSION_STALE_MS,
} from '../lib/finishedSessionQuery';
import { isHistoricalOnly } from '../lib/config';
import { useRaceStore } from '../store/raceStore';

export function HistoricalDefaultSessionLoader() {
  const queryClient = useQueryClient();
  const selectedSessionKey = useRaceStore((s) => s.selectedSessionKey);
  const historicalBrowseYear = useRaceStore((s) => s.historicalBrowseYear);
  const setSelectedSessionKey = useRaceStore((s) => s.setSelectedSessionKey);
  const setSelectedSessionInfo = useRaceStore((s) => s.setSelectedSessionInfo);

  const finishedDefaultYearArg =
    historicalBrowseYear != null && historicalBrowseYear !== ''
      ? historicalBrowseYear
      : undefined;

  /** Start loading default session before the rest of the UI mounts tabs — fewer waterfalls. */
  useEffect(() => {
    if (!isHistoricalOnly()) return;
    queryClient.prefetchQuery({
      queryKey: [...finishedDefaultSessionQueryKey(null)],
      queryFn: () => history.finishedDefaultSession(),
      staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    });
  }, [queryClient]);

  const { data, isError } = useQuery({
    queryKey: [...finishedDefaultSessionQueryKey(historicalBrowseYear)],
    queryFn: () => history.finishedDefaultSession(finishedDefaultYearArg),
    enabled: isHistoricalOnly() && selectedSessionKey === 'pending',
    staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
    retry: 2,
  });

  useEffect(() => {
    if (!isHistoricalOnly() || selectedSessionKey !== 'pending' || !data) return;
    setSelectedSessionKey(data.session_key);
    setSelectedSessionInfo({
      session_key: data.session_key,
      session_name: data.session_name,
      meeting_key: data.meeting_key,
      circuit_short_name: data.circuit_short_name,
      country_name: data.country_name,
      location: data.location,
      year: data.year,
      round: data.round,
      meeting_name: data.meeting_name,
      date_start: data.date_start,
    });
  }, [data, selectedSessionKey, setSelectedSessionKey, setSelectedSessionInfo]);

  useEffect(() => {
    if (!isHistoricalOnly() || selectedSessionKey !== 'pending' || !isError) return;
    let cancelled = false;
    const y = new Date().getFullYear() - 1;
    history
      .finishedDefaultSession(y)
      .then((d) => {
        if (cancelled) return;
        setSelectedSessionKey(d.session_key);
        setSelectedSessionInfo({
          session_key: d.session_key,
          session_name: d.session_name,
          meeting_key: d.meeting_key,
          circuit_short_name: d.circuit_short_name,
          country_name: d.country_name,
          location: d.location,
          year: d.year,
          round: d.round,
          meeting_name: d.meeting_name,
          date_start: d.date_start,
        });
      })
      .catch(() => {
        if (!cancelled) setSelectedSessionKey('latest');
      });
    return () => {
      cancelled = true;
    };
  }, [isError, selectedSessionKey, setSelectedSessionKey, setSelectedSessionInfo]);

  return null;
}
