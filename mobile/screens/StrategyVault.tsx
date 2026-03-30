/**
 * StrategyVault — live or historical strategy panel.
 * Shows per-driver pit stop timings and tyre compound sequences.
 * Pull from OpenF1 /stints + /pit + /drivers.
 */

import React, { useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../lib/api';
import type { Stint, Pit, Driver } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { SessionPicker } from '../components/SessionPicker';
import { CompoundBadge } from '../components/CompoundBadge';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { isHistoricalOnly } from '../lib/config';
import { useStableLiveList } from '../hooks/useStableLiveList';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DriverStrategy {
  driver: Driver;
  stints: Stint[];
  pits: Pit[];
  totalLaps: number;
}

/** API may send pit_duration as string; guard before .toFixed */
function pitDurationSeconds(pit: Pit): number | null {
  const v = pit.pit_duration;
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ── Strategy row ───────────────────────────────────────────────────────────────

function PitBadge({ pit }: { pit: Pit }) {
  const sec = pitDurationSeconds(pit);
  const duration = sec != null ? `${sec.toFixed(1)}s` : null;
  return (
    <View style={styles.pitBadge}>
      <Text style={styles.pitLap}>L{pit.lap_number}</Text>
      {duration && <Text style={styles.pitDuration}>{duration}</Text>}
    </View>
  );
}

function StrategyRow({ item }: { item: DriverStrategy }) {
  const { driver, stints, pits, totalLaps } = item;
  const teamColor = driver.team_colour ? `#${driver.team_colour}` : Colors.primary;

  const sortedStints = [...stints].sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));
  const sortedPits = [...pits].sort((a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0));

  // Stint bar widths proportional to laps
  const lapsForFlex = totalLaps > 0 ? totalLaps : 60;

  return (
    <View style={styles.strategyCard}>
      {/* Team stripe */}
      <View style={[styles.teamStripe, { backgroundColor: teamColor }]} />

      <View style={styles.cardContent}>
        {/* Driver header */}
        <View style={styles.cardHeader}>
          <Text style={[styles.driverNum, { color: teamColor }]}>
            {driver.driver_number}
          </Text>
          <View style={styles.driverInfo}>
            <Text style={styles.driverAcronym}>{driver.name_acronym ?? '—'}</Text>
            <Text style={styles.driverTeam} numberOfLines={1}>
              {driver.team_name ?? '—'}
            </Text>
          </View>
          <Text style={styles.stintCount}>
            {sortedStints.length} STINT{sortedStints.length !== 1 ? 'S' : ''}
          </Text>
        </View>

        {/* Stint visualisation bar */}
        {sortedStints.length > 0 && (
          <View style={styles.stintBar}>
            {sortedStints.map((s, i) => {
              const start = s.lap_start ?? 1;
              const end = s.lap_end ?? start;
              const laps = Math.max(end - start + 1, 1);
              const compound = s.compound?.toUpperCase() ?? '';
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
                      backgroundColor: color,
                      opacity: 0.85,
                    },
                  ]}
                >
                  {laps >= 5 && (
                    <Text style={styles.stintSegmentText}>{laps}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Compound sequence */}
        <View style={styles.compoundRow}>
          {sortedStints.map((s, i) => {
            const start = s.lap_start ?? 0;
            const end = s.lap_end ?? start;
            const laps = Math.max(end - start + 1, 1);
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <View style={styles.pitArrow}>
                    <Text style={styles.pitArrowLine}>—</Text>
                    {sortedPits[i - 1] && (
                      <PitBadge pit={sortedPits[i - 1]} />
                    )}
                    <Text style={styles.pitArrowLine}>→</Text>
                  </View>
                )}
                <View style={styles.compoundItem}>
                  <CompoundBadge compound={s.compound ?? ''} size="lg" />
                  <Text style={styles.compoundLaps}>{laps}L</Text>
                  {s.tyre_age_at_start != null && s.tyre_age_at_start > 0 && (
                    <Text style={styles.usedTyre}>+{s.tyre_age_at_start}</Text>
                  )}
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* Pit summary */}
        {sortedPits.length > 0 && (
          <View style={styles.pitSummary}>
            <Text style={styles.pitSummaryLabel}>STOPS: </Text>
            {sortedPits.map((p, i) => {
              const dur = pitDurationSeconds(p);
              return (
              <View key={i} style={styles.pitSummaryItem}>
                <Text style={styles.pitSummaryLap}>L{p.lap_number}</Text>
                {dur != null && (
                  <Text style={styles.pitSummaryDuration}>{dur.toFixed(1)}s</Text>
                )}
              </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function StrategyVault() {
  const { selectedSessionKey, effectiveKey, openF1KeyReady, sessionLikelyHasStints } =
    useOpenF1LiveContext();
  const pollLive = selectedSessionKey === 'latest' && !isHistoricalOnly();
  const keyOk = effectiveKey !== null;

  const { data: stintsRaw, isLoading: loadingStints, refetch, isRefetching } = useQuery({
    queryKey: ['stints', effectiveKey],
    queryFn: () => live.stints(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 10000 : false,
  });

  const { data: pitsRaw } = useQuery({
    queryKey: ['pits', effectiveKey],
    queryFn: () => live.pits(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 10000 : false,
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
    refetchInterval: pollLive && keyOk ? 15000 : false,
    staleTime: 12000,
  });

  const sessionId = effectiveKey;
  const stints = useStableLiveList(sessionId, pollLive, stintsRaw);
  const drivers = useStableLiveList(sessionId, pollLive, driversRaw);
  const pits = useStableLiveList(sessionId, pollLive, pitsRaw);
  const laps = useStableLiveList(sessionId, pollLive, lapsRaw);

  const strategies: DriverStrategy[] = useMemo(() => {
    if (!drivers || !stints) return [];

    const maxLap = laps?.reduce((max, l) => Math.max(max, l.lap_number ?? 0), 0) ?? 0;

    return drivers
      .map((driver) => {
        const driverStints = stints
          .filter((s) => s.driver_number === driver.driver_number)
          .sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));

        // Fill in ongoing lap_end
        const filledStints = driverStints.map((s, i) => {
          if (s.lap_end == null && i === driverStints.length - 1 && maxLap > 0) {
            return { ...s, lap_end: maxLap };
          }
          return s;
        });

        const driverPits = (pits ?? [])
          .filter((p) => p.driver_number === driver.driver_number)
          .sort((a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0));

        return {
          driver,
          stints: filledStints,
          pits: driverPits,
          totalLaps: maxLap,
        };
      })
      .filter((d) => d.stints.length > 0)
      .sort((a, b) => a.driver.driver_number - b.driver.driver_number);
  }, [drivers, stints, pits, laps]);

  const loading = !openF1KeyReady || loadingStints || loadingDrivers;

  return (
    <View style={styles.container}>
      {!openF1KeyReady ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Syncing with the timing feed…</Text>
        </View>
      ) : loading && strategies.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading strategy data…</Text>
        </View>
      ) : (
        <FlatList
          data={strategies}
          keyExtractor={(item) => String(item.driver.driver_number)}
          renderItem={({ item }) => <StrategyRow item={item} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>RACE STRATEGY</Text>
                {pollLive && (
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeText}>LIVE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.subtitle}>
                Tyre compounds, stint lengths & pit stop timings
              </Text>

              <View style={styles.pickerRow}>
                <SessionPicker />
              </View>

              {/* Compound legend */}
              <View style={styles.legend}>
                {(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'] as const).map((c) => (
                  <View key={c} style={styles.legendItem}>
                    <CompoundBadge compound={c} size="sm" showLabel />
                  </View>
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.centered}>
                <Text style={styles.emptyIcon}>🔄</Text>
                <Text style={styles.emptyTitle}>No strategy data</Text>
                <Text style={styles.emptyText}>
                  {sessionLikelyHasStints
                    ? 'Stints appear once the session is running and OpenF1 publishes tyre data. Pull to refresh.'
                    : 'Stint and pit data are not published for typical qualifying or practice sessions. Switch to the Race session or pick it from the menu above.'}
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
  list: { paddingBottom: Spacing.xl },

  listHeader: { backgroundColor: Colors.background },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  subtitle: {
    color: Colors.textMuted, fontSize: 10, letterSpacing: 0.5,
    paddingHorizontal: Spacing.md, marginTop: 2,
  },
  liveBadge: {
    backgroundColor: Colors.primary + '22', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  liveBadgeText: { color: Colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },

  pickerRow: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    marginTop: Spacing.xs,
  },

  legend: {
    flexDirection: 'row', gap: Spacing.lg, flexWrap: 'wrap',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  legendItem: {},

  // Strategy card
  strategyCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface, marginHorizontal: Spacing.sm,
    marginBottom: Spacing.xs, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  teamStripe: { width: 4 },
  cardContent: { flex: 1, padding: Spacing.sm, gap: Spacing.sm },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  driverNum: {
    fontSize: FontSize.xxl, fontWeight: '900',
    letterSpacing: -1, minWidth: 36,
  },
  driverInfo: { flex: 1 },
  driverAcronym: { color: Colors.text, fontSize: FontSize.md, fontWeight: '900', letterSpacing: 1 },
  driverTeam: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
  stintCount: { color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },

  // Stint bar
  stintBar: {
    flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden',
    backgroundColor: Colors.surfaceHigh, gap: 1,
  },
  stintSegment: {
    height: '100%', justifyContent: 'center', alignItems: 'center',
  },
  stintSegmentText: { color: '#000', fontSize: 7, fontWeight: '800' },

  // Compound sequence
  compoundRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4,
  },
  compoundItem: { alignItems: 'center', gap: 2 },
  compoundLaps: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  usedTyre: { color: Colors.textMuted, fontSize: 9 },

  pitArrow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pitArrowLine: { color: Colors.textMuted, fontSize: 10 },

  pitBadge: {
    backgroundColor: Colors.safetyCarYellow + '22',
    borderRadius: Radius.xs, borderWidth: 1, borderColor: Colors.safetyCarYellow + '44',
    paddingHorizontal: 4, paddingVertical: 2, alignItems: 'center',
  },
  pitLap: { color: Colors.safetyCarYellow, fontSize: 8, fontWeight: '800' },
  pitDuration: { color: Colors.textMuted, fontSize: 8 },

  // Pit summary row
  pitSummary: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
  },
  pitSummaryLabel: {
    color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1,
  },
  pitSummaryItem: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.surfaceHigh, borderRadius: Radius.xs,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  pitSummaryLap: { color: Colors.text, fontSize: 10, fontWeight: '700' },
  pitSummaryDuration: { color: Colors.textMuted, fontSize: 10 },

  emptyIcon: { fontSize: 40 },
  emptyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
});
