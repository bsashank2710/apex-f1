/**
 * TyreTracker — tyre compound, age, and full stint breakdown per driver.
 * Uses the shared session picker; works for any past or live session.
 */

import React from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../lib/api';
import type { Stint, Driver } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { CompoundBadge } from '../components/CompoundBadge';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { isHistoricalOnly } from '../lib/config';
import { useStableLiveList } from '../hooks/useStableLiveList';

interface DriverTyreData {
  driver: Driver;
  stints: Stint[];
  currentStint: Stint | null;
  totalLaps: number;
}

function StintBar({ stints, totalLaps }: { stints: Stint[]; totalLaps: number }) {
  if (stints.length === 0) return null;
  const lapsForFlex = totalLaps > 0 ? totalLaps : 60;

  return (
    <View style={styles.stintBarOuter}>
      {stints.map((s, i) => {
        const start = s.lap_start ?? 1;
        const end = s.lap_end ?? start;
        const laps = Math.max(end - start + 1, 1);
        const compound = s.compound?.toUpperCase() ?? 'UNKNOWN';
        const colorMap: Record<string, string> = {
          SOFT: Colors.soft,
          MEDIUM: Colors.medium,
          HARD: Colors.hard,
          INTERMEDIATE: Colors.intermediate,
          WET: Colors.wet,
        };
        const color = colorMap[compound] ?? Colors.textMuted;

        return (
          <View
            key={i}
            style={[
              styles.stintSegment,
              {
                flex: laps / lapsForFlex,
                backgroundColor: color + 'CC',
                borderRightWidth: i < stints.length - 1 ? 1 : 0,
                borderRightColor: Colors.background,
              },
            ]}
          >
            {laps >= 4 && (
              <Text style={styles.stintSegmentText}>{laps}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function DriverTyreRow({ item, rank }: { item: DriverTyreData; rank: number }) {
  const { driver, stints, currentStint, totalLaps } = item;
  const teamColor = driver.team_colour ? `#${driver.team_colour}` : Colors.primary;
  const currentLaps = currentStint
    ? (totalLaps - (currentStint.lap_start ?? 1) + 1)
    : 0;

  return (
    <View style={styles.row}>
      {/* Team colour stripe */}
      <View style={[styles.teamStripe, { backgroundColor: teamColor }]} />

      {/* Position */}
      <Text style={styles.rankNum}>{rank}</Text>

      {/* Driver info */}
      <View style={styles.rowContent}>
        {/* Top row: acronym + current tyre + age */}
        <View style={styles.rowHeader}>
          <Text style={styles.acronym}>{driver.name_acronym ?? `#${driver.driver_number}`}</Text>
          {currentStint?.compound && (
            <CompoundBadge compound={currentStint.compound} size="md" />
          )}
          <Text style={styles.tyreAge}>
            {currentLaps > 0 ? `${currentLaps} laps` : '—'}
          </Text>
          <Text style={styles.stintNum}>
            STINT {currentStint?.stint_number ?? '—'}
          </Text>
        </View>

        {/* Stint bar */}
        <StintBar stints={stints} totalLaps={totalLaps} />

        {/* Stint detail pills */}
        <View style={styles.stintPills}>
          {stints.map((s, i) => {
            const laps = Math.max((s.lap_end ?? s.lap_start ?? 1) - (s.lap_start ?? 1) + 1, 1);
            return (
              <View key={i} style={styles.stintPill}>
                <CompoundBadge compound={s.compound ?? ''} size="sm" />
                <Text style={styles.stintPillText}>{laps}L</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TyreTracker() {
  const {
    selectedSessionKey,
    effectiveKey,
    openF1KeyReady,
    sessionLikelyHasStints,
    mapFocus,
  } = useOpenF1LiveContext();
  const pollLive = selectedSessionKey === 'latest' && !isHistoricalOnly();
  const keyOk = effectiveKey !== null;

  const { data: stintsRaw, isLoading: loadingStints, refetch, isRefetching } = useQuery({
    queryKey: ['stints', effectiveKey],
    queryFn: () => live.stints(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 8000 : false,
  });

  const { data: driversRaw, isLoading: loadingDrivers } = useQuery({
    queryKey: ['drivers', effectiveKey],
    queryFn: () => live.drivers(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 8000 : false,
  });

  const { data: lapsRaw } = useQuery({
    queryKey: ['laps_for_count', effectiveKey],
    queryFn: () => live.laps(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 12000 : false,
    staleTime: 8000,
  });

  const sessionId = effectiveKey;
  const stints = useStableLiveList(sessionId, pollLive, stintsRaw);
  const drivers = useStableLiveList(sessionId, pollLive, driversRaw);
  const laps = useStableLiveList(sessionId, pollLive, lapsRaw);

  const tyreData: DriverTyreData[] = React.useMemo(() => {
    if (!drivers || !stints) return [];

    // Find max lap number for this session
    const maxLap = laps?.reduce((max, l) => Math.max(max, l.lap_number ?? 0), 0) ?? 0;

    return drivers.map((driver) => {
      const driverStints = stints
        .filter((s) => s.driver_number === driver.driver_number)
        .sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));

      const currentStint = driverStints.length > 0
        ? driverStints[driverStints.length - 1]
        : null;

      // Fill in lap_end for ongoing stints using max lap
      const filledStints = driverStints.map((s, i) => {
        if (s.lap_end == null && i === driverStints.length - 1 && maxLap > 0) {
          return { ...s, lap_end: maxLap };
        }
        return s;
      });

      return {
        driver,
        stints: filledStints,
        currentStint,
        totalLaps: maxLap,
      };
    }).filter(d => d.stints.length > 0);
  }, [drivers, stints, laps]);

  const loading = !openF1KeyReady || loadingStints || loadingDrivers;
  const sessionLabel = mapFocus?.session_name ?? 'this session';

  return (
    <View style={styles.container}>
      {!openF1KeyReady ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Syncing with the timing feed…</Text>
          <Text style={styles.loadingSub}>
            {isHistoricalOnly()
              ? 'Resolving default or selected session for stints and tyres.'
              : 'Resolving which session OpenF1 is publishing (map_session).'}
          </Text>
        </View>
      ) : loading && tyreData.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading tyre data…</Text>
        </View>
      ) : (
        <FlatList
          data={tyreData}
          keyExtractor={(item) => String(item.driver.driver_number)}
          renderItem={({ item, index }) => <DriverTyreRow item={item} rank={index + 1} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {/* Title row */}
              <View style={styles.titleRow}>
                <Text style={styles.title}>TYRE TRACKER</Text>
                {pollLive && (
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </View>
                )}
              </View>

              {/* Compound legend */}
              <View style={styles.legend}>
                {(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'] as const).map((c) => (
                  <View key={c} style={styles.legendItem}>
                    <CompoundBadge compound={c} size="sm" />
                    <Text style={styles.legendText}>{c[0]}</Text>
                  </View>
                ))}
              </View>

              {/* Column headers */}
              <View style={styles.colHeader}>
                <Text style={[styles.colHeaderText, { width: 32 }]}>#</Text>
                <Text style={[styles.colHeaderText, { width: 44 }]}>DRV</Text>
                <Text style={[styles.colHeaderText, { flex: 1 }]}>CURRENT</Text>
                <Text style={[styles.colHeaderText, { width: 60 }]}>STINT</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.centered}>
                <Text style={styles.emptyIcon}>🏎</Text>
                <Text style={styles.emptyTitle}>
                  {!sessionLikelyHasStints ? 'No stint data for this session' : 'No tyre data'}
                </Text>
                <Text style={styles.emptyText}>
                  {!sessionLikelyHasStints
                    ? `OpenF1 does not publish pit-stop stints during ${sessionLabel}. Use Lap Log for sector times, or open the Race after lights out.`
                    : 'Pull to refresh, or pick a specific session above if the feed is empty.'}
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingVertical: Spacing.xxl, gap: Spacing.sm,
  },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md, fontSize: FontSize.sm },
  loadingSub: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    lineHeight: 18,
  },
  list: { paddingBottom: Spacing.xl },

  listHeader: { backgroundColor: Colors.background },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  liveBadge: {
    backgroundColor: Colors.primary + '22', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  liveBadgeText: { color: Colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  legend: {
    flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { color: Colors.textSecondary, fontSize: FontSize.xs },

  colHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  colHeaderText: { color: Colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  // Driver row
  row: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.sm, marginBottom: 2,
    borderRadius: Radius.sm, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  teamStripe: { width: 3 },
  rankNum: {
    width: 28, color: Colors.textMuted,
    fontSize: FontSize.sm, fontWeight: '700', textAlign: 'center',
    paddingVertical: Spacing.sm, alignSelf: 'center',
  },
  rowContent: { flex: 1, paddingVertical: Spacing.sm, paddingRight: Spacing.sm, gap: 6 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  acronym: {
    color: Colors.text, fontSize: FontSize.sm, fontWeight: '900',
    letterSpacing: 1, width: 36,
  },
  tyreAge: { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },
  stintNum: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

  // Stint bar
  stintBarOuter: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden',
    backgroundColor: Colors.surfaceHigh,
  },
  stintSegment: {
    height: '100%', justifyContent: 'center', alignItems: 'center',
  },
  stintSegmentText: { color: '#fff', fontSize: 7, fontWeight: '700' },

  // Stint pills
  stintPills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  stintPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.surfaceHigh, borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  stintPillText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

  emptyIcon: { fontSize: 40 },
  emptyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
});
