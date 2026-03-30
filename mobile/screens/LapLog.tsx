/**
 * LapLog — per-lap timing table with sector times.
 * Session picker + fastest lap highlighting + driver filter.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../lib/api';
import type { Lap, Driver } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { isHistoricalOnly } from '../lib/config';
import { useStableLiveList } from '../hooks/useStableLiveList';

// ── Time formatter ─────────────────────────────────────────────────────────────

function formatTime(seconds?: number | null): string {
  if (seconds == null || isNaN(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${s}` : `${s}`;
}

function formatSector(seconds?: number | null): string {
  if (seconds == null || isNaN(seconds)) return '—';
  return seconds.toFixed(3);
}

// ── Sort options ───────────────────────────────────────────────────────────────

type SortKey = 'lap' | 'time';

interface LapRow extends Lap {
  driver?: Driver;
  isFastest?: boolean;
}

// ── Row component ──────────────────────────────────────────────────────────────

function LapRowItem({ item }: { item: LapRow }) {
  const teamColor = item.driver?.team_colour ? `#${item.driver.team_colour}` : Colors.textMuted;
  const isFastest = item.isFastest;

  return (
    <View style={[styles.row, isFastest && styles.rowFastest]}>
      <View style={[styles.teamBar, { backgroundColor: teamColor }]} />
      <Text style={styles.driver}>
        {item.driver?.name_acronym ?? `#${item.driver_number}`}
      </Text>
      <Text style={styles.lap}>L{item.lap_number ?? '—'}</Text>
      <Text style={[
        styles.lapTime,
        item.lap_duration != null && styles.lapTimeValue,
        isFastest && styles.lapTimeFastest,
      ]}>
        {isFastest && '⚡ '}{formatTime(item.lap_duration)}
      </Text>
      <Text style={[styles.sector, getSectorStyle(item.duration_sector_1)]}>
        {formatSector(item.duration_sector_1)}
      </Text>
      <Text style={[styles.sector, getSectorStyle(item.duration_sector_2)]}>
        {formatSector(item.duration_sector_2)}
      </Text>
      <Text style={[styles.sector, getSectorStyle(item.duration_sector_3)]}>
        {formatSector(item.duration_sector_3)}
      </Text>
      {item.is_pit_out_lap && (
        <View style={styles.pitBadge}>
          <Text style={styles.pitBadgeText}>PIT</Text>
        </View>
      )}
    </View>
  );
}

function getSectorStyle(val?: number | null) {
  if (val == null) return {};
  return {};
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function LapLog() {
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('lap');
  const { selectedSessionKey, effectiveKey, openF1KeyReady } = useOpenF1LiveContext();
  const pollLive = selectedSessionKey === 'latest' && !isHistoricalOnly();
  const keyOk = effectiveKey !== null;

  const { data: lapsRaw, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['laps', effectiveKey, selectedDriver],
    queryFn: () => live.laps(effectiveKey!, selectedDriver ?? undefined),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 5000 : false,
  });

  const { data: driversRaw } = useQuery({
    queryKey: ['drivers', effectiveKey],
    queryFn: () => live.drivers(effectiveKey!),
    enabled: keyOk,
    refetchInterval: pollLive && keyOk ? 8000 : false,
  });

  const lapsSessionId =
    effectiveKey != null ? `${effectiveKey}:${selectedDriver ?? 'all'}` : null;
  const laps = useStableLiveList(lapsSessionId, pollLive, lapsRaw);
  const drivers = useStableLiveList(effectiveKey, pollLive, driversRaw);

  const driverMap = useMemo(
    () => new Map((drivers ?? []).map((d) => [d.driver_number, d])),
    [drivers]
  );

  // Find overall fastest lap
  const fastestLapTime = useMemo(() => {
    const times = (laps ?? [])
      .map(l => l.lap_duration)
      .filter((t): t is number => t != null && t > 0);
    return times.length > 0 ? Math.min(...times) : null;
  }, [laps]);

  const enriched: LapRow[] = useMemo(() => {
    const rows = (laps ?? []).map((l) => ({
      ...l,
      driver: driverMap.get(l.driver_number),
      isFastest: fastestLapTime != null && l.lap_duration === fastestLapTime,
    }));

    if (sortKey === 'lap') {
      return rows.sort((a, b) => {
        if ((a.lap_number ?? 0) !== (b.lap_number ?? 0))
          return (b.lap_number ?? 0) - (a.lap_number ?? 0);
        return (a.driver_number ?? 0) - (b.driver_number ?? 0);
      });
    } else {
      return rows
        .filter(r => r.lap_duration != null && r.lap_duration > 0)
        .sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
    }
  }, [laps, driverMap, sortKey, fastestLapTime]);

  const isDriverActive = (num: number) => selectedDriver === num;

  if (!openF1KeyReady) {
    return (
      <View style={[styles.container, styles.resolvingBox]}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.resolvingTitle}>Syncing session…</Text>
        <Text style={styles.resolvingSub}>
          {isHistoricalOnly()
            ? 'Resolving default or selected session so lap times use the correct OpenF1 key.'
            : 'Waiting for map_session so lap keys match the live weekend.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={enriched}
        keyExtractor={(item, i) => `${item.driver_number}-${item.lap_number}-${i}`}
        renderItem={({ item }) => <LapRowItem item={item} />}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Title + sort */}
            <View style={styles.titleRow}>
              <Text style={styles.title}>LAP LOG</Text>
              <View style={styles.sortRow}>
                <TouchableOpacity
                  style={[styles.sortChip, sortKey === 'lap' && styles.sortChipActive]}
                  onPress={() => setSortKey('lap')}
                >
                  <Text style={[styles.sortText, sortKey === 'lap' && styles.sortTextActive]}>
                    BY LAP
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortChip, sortKey === 'time' && styles.sortChipActive]}
                  onPress={() => setSortKey('time')}
                >
                  <Text style={[styles.sortText, sortKey === 'time' && styles.sortTextActive]}>
                    FASTEST
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Driver filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
              <TouchableOpacity
                style={[styles.chip, selectedDriver === null && styles.chipActive]}
                onPress={() => setSelectedDriver(null)}
              >
                <Text style={[styles.chipText, selectedDriver === null && styles.chipTextActive]}>
                  ALL
                </Text>
              </TouchableOpacity>
              {(drivers ?? []).map((d) => {
                const color = d.team_colour ? `#${d.team_colour}` : Colors.textMuted;
                const active = isDriverActive(d.driver_number);
                return (
                  <TouchableOpacity
                    key={d.driver_number}
                    style={[
                      styles.chip,
                      active && { backgroundColor: color + '33', borderColor: color },
                    ]}
                    onPress={() => setSelectedDriver(active ? null : d.driver_number)}
                  >
                    <Text style={[styles.chipText, active && { color }]}>
                      {d.name_acronym}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Table column headers */}
            <View style={styles.tableHeader}>
              <View style={styles.teamBarPlaceholder} />
              <Text style={[styles.headerCell, { flex: 1.2 }]}>DRV</Text>
              <Text style={styles.headerCell}>LAP</Text>
              <Text style={[styles.headerCell, { flex: 2 }]}>TIME</Text>
              <Text style={styles.headerCell}>S1</Text>
              <Text style={styles.headerCell}>S2</Text>
              <Text style={styles.headerCell}>S3</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>
              {isLoading ? 'Loading lap times…' : 'No lap data'}
            </Text>
            {!isLoading && (
              <Text style={styles.emptyText}>Select a session above to view lap times.</Text>
            )}
          </View>
        }
        contentContainerStyle={styles.list}
        stickyHeaderIndices={[0]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  resolvingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  resolvingTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '800' },
  resolvingSub: { color: Colors.textMuted, fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
  header: { backgroundColor: Colors.background },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.xs,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  sortRow: { flexDirection: 'row', gap: 4 },
  sortChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sortChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  sortText: { color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  sortTextActive: { color: Colors.text },

  filterScroll: {
    maxHeight: 38,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  filterContent: {
    paddingHorizontal: Spacing.sm, paddingVertical: 6, gap: 4, alignItems: 'center',
  },
  chip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  chipTextActive: { color: Colors.text },

  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  teamBarPlaceholder: { width: 3, marginRight: Spacing.sm },
  headerCell: {
    flex: 1, color: Colors.textMuted, fontSize: 9,
    fontWeight: '800', letterSpacing: 1, paddingHorizontal: 2,
  },

  list: { paddingBottom: Spacing.xl },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingRight: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '40',
    backgroundColor: Colors.background,
  },
  rowFastest: { backgroundColor: Colors.drsGreen + '10' },
  teamBar: { width: 3, height: '100%', marginRight: Spacing.sm },
  driver: {
    flex: 1.2, color: Colors.text, fontSize: FontSize.xs,
    fontWeight: '800', letterSpacing: 0.5,
  },
  lap: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.xs },
  lapTime: {
    flex: 2, color: Colors.textMuted, fontSize: FontSize.xs,
    fontFamily: 'monospace',
  },
  lapTimeValue: { color: Colors.text },
  lapTimeFastest: { color: Colors.drsGreen },
  sector: {
    flex: 1, color: Colors.textSecondary, fontSize: 10,
    fontFamily: 'monospace',
  },
  pitBadge: {
    backgroundColor: Colors.primary + '33',
    borderRadius: Radius.xs, borderWidth: 1, borderColor: Colors.primary + '55',
    paddingHorizontal: 4, paddingVertical: 1, marginLeft: 4,
  },
  pitBadgeText: { color: Colors.primary, fontSize: 8, fontWeight: '800' },

  empty: {
    alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm,
  },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center' },
});
