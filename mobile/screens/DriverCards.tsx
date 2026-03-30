/**
 * DriverCards — driver roster with team colors, stats, and championship standing.
 * Pulls live driver data from OpenF1 + standings from Ergast/Jolpica.
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  TouchableOpacity, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live, history } from '../lib/api';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { isHistoricalOnly } from '../lib/config';
import type { Driver, DriverStanding } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { CompoundBadge } from '../components/CompoundBadge';

// ── Driver card ────────────────────────────────────────────────────────────────

// Upgrade F1 media CDN transform from 1col (tiny) → 3col (full res)
function hiResUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace('/1col/', '/3col/');
}

function HeadshotImage({ url, acronym, color, size }: { url?: string; acronym?: string; color: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const containerStyle = size
    ? { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' as const, backgroundColor: color + '15' }
    : undefined;
  const src = hiResUrl(url);

  if (src && !failed) {
    return (
      <View style={[containerStyle ?? styles.headshotContainer, { backgroundColor: color + '15' }]}>
        <Image
          source={{ uri: src }}
          style={containerStyle ? { width: size, height: size } : styles.headshot}
          resizeMode="contain"
          onError={() => setFailed(true)}
          onLoad={(e: any) => {
            // F1 CDN returns a tiny generic silhouette (~2500 bytes, ~200x200) when
            // the driver has no official photo. Real portraits are tall (height >> width).
            const w = e?.nativeEvent?.source?.width;
            const h = e?.nativeEvent?.source?.height;
            if (w && h && h <= w) setFailed(true); // not portrait → it's the fallback
          }}
        />
      </View>
    );
  }

  return (
    <View style={[containerStyle ?? styles.headshotContainer, styles.headshotFallback, { backgroundColor: color + '22' }]}>
      <Text style={[styles.headshotInitials, { color }]}>{acronym ?? '?'}</Text>
    </View>
  );
}

function DriverCard({
  driver,
  standing,
  nationality,
  selected,
  onPress,
}: {
  driver: Driver;
  standing?: DriverStanding;
  nationality?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const teamColor = driver.team_colour ? `#${driver.team_colour}` : Colors.primary;

  return (
    <TouchableOpacity
      style={[styles.card, selected && { borderColor: teamColor, borderWidth: 2 }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Left team stripe */}
      <View style={[styles.teamStripe, { backgroundColor: teamColor }]} />

      <View style={styles.cardInner}>
        {/* Headshot */}
        <HeadshotImage url={driver.headshot_url} acronym={driver.name_acronym} color={teamColor} />

        {/* Driver number */}
        <View style={[styles.numberBadge, { backgroundColor: teamColor + '22', borderColor: teamColor + '44' }]}>
          <Text style={[styles.driverNumber, { color: teamColor }]}>
            {driver.driver_number}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.acronym}>{driver.name_acronym}</Text>
          <Text style={styles.fullName} numberOfLines={1}>
            {driver.full_name ?? ''}
          </Text>
          <Text style={styles.team} numberOfLines={1}>
            {driver.team_name ?? ''}
          </Text>
          {nationality && (
            <Text style={styles.nationality} numberOfLines={1}>{nationality}</Text>
          )}

          {/* Standing stats */}
          {standing && (
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: teamColor }]}>
                  P{standing.position}
                </Text>
                <Text style={styles.statLabel}>POS</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{standing.points}</Text>
                <Text style={styles.statLabel}>PTS</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{standing.wins}</Text>
                <Text style={styles.statLabel}>WINS</Text>
              </View>
            </View>
          )}

          {/* Live compound badge */}
          {driver.compound && (
            <View style={styles.compoundRow}>
              <CompoundBadge compound={driver.compound} size="sm" showLabel />
              {driver.tyre_age != null && (
                <Text style={styles.tyreAge}>{driver.tyre_age}L</Text>
              )}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Expanded driver detail ─────────────────────────────────────────────────────

function DriverDetail({ driver, standing, nationality }: { driver: Driver; standing?: DriverStanding; nationality?: string }) {
  const teamColor = driver.team_colour ? `#${driver.team_colour}` : Colors.primary;

  return (
    <View style={[styles.detailCard, { borderColor: teamColor + '40' }]}>
      {/* Header band */}
      <View style={[styles.detailHeader, { backgroundColor: teamColor + '18', borderBottomColor: teamColor + '30' }]}>
        <HeadshotImage url={driver.headshot_url} acronym={driver.name_acronym} color={teamColor} size={80} />
        <View style={styles.detailHeaderInfo}>
          <Text style={[styles.detailNumber, { color: teamColor }]}>
            #{driver.driver_number}
          </Text>
          <Text style={styles.detailName}>{driver.full_name ?? driver.name_acronym}</Text>
          <Text style={[styles.detailTeam, { color: teamColor }]}>{driver.team_name}</Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.detailGrid}>
        <View style={styles.detailCell}>
          <Text style={styles.detailLabel}>NATIONALITY</Text>
          <Text style={styles.detailValue}>{nationality ?? driver.country_code ?? '—'}</Text>
        </View>
        {standing && (
          <>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>CHAMPIONSHIP</Text>
              <Text style={[styles.detailValue, { color: teamColor }]}>P{standing.position}</Text>
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>POINTS</Text>
              <Text style={styles.detailValue}>{standing.points}</Text>
            </View>
            <View style={styles.detailCell}>
              <Text style={styles.detailLabel}>WINS</Text>
              <Text style={styles.detailValue}>{standing.wins}</Text>
            </View>
          </>
        )}
        {driver.compound && (
          <View style={styles.detailCell}>
            <Text style={styles.detailLabel}>ON TYRE</Text>
            <CompoundBadge compound={driver.compound} size="md" showLabel />
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function DriverCards() {
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const { effectiveKey, openF1KeyReady, selectedSessionKey } = useOpenF1LiveContext();
  const pollLive = selectedSessionKey === 'latest' && !isHistoricalOnly();

  const { data: drivers, isLoading: loadingDrivers, refetch, isRefetching } = useQuery({
    queryKey: ['drivers', effectiveKey],
    queryFn: () => live.drivers(effectiveKey!),
    enabled: openF1KeyReady && effectiveKey != null,
    refetchInterval: pollLive && openF1KeyReady ? 60_000 : false,
  });

  const { data: overview } = useQuery({
    queryKey: ['season_overview', new Date().getFullYear()],
    queryFn: () => history.seasonOverview(new Date().getFullYear()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: ergastDrivers } = useQuery({
    queryKey: ['ergast_drivers', new Date().getFullYear()],
    queryFn: () => history.drivers(new Date().getFullYear()),
    staleTime: 60 * 60 * 1000,
  });

  const nationalityMap = React.useMemo(() => {
    const map = new Map<string, string>();
    (ergastDrivers ?? []).forEach((d: any) => {
      if (d.code) map.set(d.code, d.nationality);
    });
    return map;
  }, [ergastDrivers]);

  const standingsMap = React.useMemo(() => {
    const map = new Map<string, DriverStanding>();
    (overview?.driver_standings ?? []).forEach((s) => {
      if (s.Driver.code) map.set(s.Driver.code, s);
      if (s.Driver.permanentNumber) map.set(s.Driver.permanentNumber, s);
    });
    return map;
  }, [overview]);

  const selectedDriver = drivers?.find((d) => d.driver_number === selectedNumber);
  const selectedStanding = selectedDriver?.name_acronym
    ? standingsMap.get(selectedDriver.name_acronym)
    : undefined;

  if (loadingDrivers) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading driver roster…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={drivers ?? []}
      keyExtractor={(d) => String(d.driver_number)}
      numColumns={2}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.gridRow}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
      }
      renderItem={({ item }) => (
        <DriverCard
          driver={item}
          standing={standingsMap.get(item.name_acronym ?? '')}
          nationality={nationalityMap.get(item.name_acronym ?? '')}
          selected={selectedNumber === item.driver_number}
          onPress={() =>
            setSelectedNumber(selectedNumber === item.driver_number ? null : item.driver_number)
          }
        />
      )}
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <Text style={styles.title}>DRIVERS</Text>
          <Text style={styles.subtitle}>
            {new Date().getFullYear()} Season · {drivers?.length ?? 0} drivers
          </Text>

          {selectedDriver && (
            <DriverDetail
              driver={selectedDriver}
              standing={selectedStanding}
              nationality={nationalityMap.get(selectedDriver.name_acronym ?? '')}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No driver data available</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.background, gap: Spacing.sm,
  },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  listHeader: {
    paddingHorizontal: Spacing.sm, paddingTop: Spacing.md, paddingBottom: Spacing.xs,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  subtitle: { color: Colors.textMuted, fontSize: 10, marginBottom: Spacing.sm },

  grid: {
    paddingHorizontal: Spacing.sm, paddingBottom: Spacing.xl,
    backgroundColor: Colors.background,
  },
  gridRow: { gap: Spacing.sm, marginBottom: Spacing.sm },

  card: {
    flex: 1, backgroundColor: Colors.surface,
    borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, overflow: 'hidden',
    flexDirection: 'row',
  },
  teamStripe: { width: 4 },
  cardInner: { flex: 1, overflow: 'hidden' },

  headshotContainer: { width: '100%', height: 160, overflow: 'hidden' },
  headshot: { width: '100%', height: 160 },
  headshotFallback: {
    justifyContent: 'center', alignItems: 'center',
  },
  headshotInitials: { fontSize: FontSize.xxl, fontWeight: '900' },

  numberBadge: {
    position: 'absolute', top: 4, right: 4,
    borderRadius: Radius.xs, borderWidth: 1,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  driverNumber: { fontSize: FontSize.sm, fontWeight: '900' },

  cardInfo: { padding: Spacing.xs },
  acronym: { color: Colors.text, fontSize: FontSize.md, fontWeight: '900', letterSpacing: 1 },
  nationality: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },
  fullName: { color: Colors.textSecondary, fontSize: 10, marginTop: 1 },
  team: { color: Colors.textMuted, fontSize: 9, marginBottom: Spacing.xs },

  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: Colors.text, fontSize: FontSize.xs, fontWeight: '900' },
  statLabel: { color: Colors.textMuted, fontSize: 8, letterSpacing: 0.5, marginTop: 1 },
  statDivider: { width: 1, height: 20, backgroundColor: Colors.border },

  compoundRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  tyreAge: { color: Colors.textMuted, fontSize: 9 },

  // Expanded detail
  detailCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, overflow: 'hidden', marginBottom: Spacing.md,
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderBottomWidth: 1,
  },
  detailHeaderInfo: { flex: 1 },
  detailNumber: { fontSize: FontSize.xxl, fontWeight: '900', letterSpacing: -1 },
  detailName: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '900', marginTop: 2 },
  detailTeam: { fontSize: FontSize.xs, fontWeight: '600', marginTop: 2 },

  detailGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: Spacing.sm, gap: Spacing.sm,
  },
  detailCell: { minWidth: '28%' },
  detailLabel: {
    color: Colors.textMuted, fontSize: 9, fontWeight: '800',
    letterSpacing: 1, marginBottom: 3,
  },
  detailValue: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },

  empty: {
    padding: Spacing.xl, alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
