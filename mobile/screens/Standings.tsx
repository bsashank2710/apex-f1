/**
 * Standings — WDC, WCC championship standings + 2026 race results browser.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { history } from '../lib/api';
import type { DriverStanding, ConstructorStanding, ErgastRace, ErgastResult } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

const YEAR = new Date().getFullYear();

type Tab = 'drivers' | 'constructors' | 'races';

// ── Points bar ─────────────────────────────────────────────────────────────────

function PointsBar({ points, maxPoints }: { points: number; maxPoints: number }) {
  const width = maxPoints > 0 ? (points / maxPoints) * 200 : 0;
  return (
    <View style={styles.barContainer}>
      <View style={[styles.bar, { width }]} />
    </View>
  );
}

// ── Driver standing row ────────────────────────────────────────────────────────

function DriverStandingRow({ item, maxPoints }: { item: DriverStanding; maxPoints: number }) {
  const points = Number(item.points);
  const teamName = item.Constructors?.[0]?.name ?? '';
  return (
    <View style={styles.row}>
      <Text style={[styles.position, Number(item.position) <= 3 ? styles.podium : {}]}>
        {item.position}
      </Text>
      <View style={styles.driverInfo}>
        <Text style={styles.name}>
          {item.Driver.givenName[0]}. {item.Driver.familyName}
        </Text>
        <Text style={styles.team}>{teamName}</Text>
        <PointsBar points={points} maxPoints={maxPoints} />
      </View>
      <View style={styles.pointsCol}>
        <Text style={styles.points}>{item.points}</Text>
        {item.wins !== '0' && <Text style={styles.wins}>{item.wins}W</Text>}
      </View>
    </View>
  );
}

// ── Constructor standing row ───────────────────────────────────────────────────

function ConstructorStandingRow({ item, maxPoints }: { item: ConstructorStanding; maxPoints: number }) {
  const points = Number(item.points);
  return (
    <View style={styles.row}>
      <Text style={[styles.position, Number(item.position) <= 3 ? styles.podium : {}]}>
        {item.position}
      </Text>
      <View style={styles.driverInfo}>
        <Text style={styles.name}>{item.Constructor.name}</Text>
        <Text style={styles.team}>{item.Constructor.nationality}</Text>
        <PointsBar points={points} maxPoints={maxPoints} />
      </View>
      <View style={styles.pointsCol}>
        <Text style={styles.points}>{item.points}</Text>
        {item.wins !== '0' && <Text style={styles.wins}>{item.wins}W</Text>}
      </View>
    </View>
  );
}

// ── Race result row ────────────────────────────────────────────────────────────

function RaceResultRow({ result, index }: { result: ErgastResult; index: number }) {
  const isPodium = index < 3;
  return (
    <View style={styles.resultRow}>
      <Text style={[styles.resultPos, isPodium && styles.podium]}>P{result.position}</Text>
      <View style={styles.resultInfo}>
        <Text style={styles.resultDriver}>
          {result.Driver.givenName[0]}. {result.Driver.familyName}
        </Text>
        <Text style={styles.resultTeam}>{result.Constructor?.name ?? ''}</Text>
      </View>
      <View style={styles.resultRight}>
        <Text style={styles.resultPoints}>{result.points} pts</Text>
        <Text style={styles.resultStatus} numberOfLines={1}>{result.status}</Text>
      </View>
    </View>
  );
}

// ── Race card ──────────────────────────────────────────────────────────────────

function RaceCard({ race }: { race: ErgastRace }) {
  const [expanded, setExpanded] = useState(false);
  const isPast = new Date(race.date) <= new Date();

  const { data: results, isLoading } = useQuery({
    queryKey: ['race_results', race.season, race.round],
    queryFn: () => history.raceResults(race.season, race.round),
    enabled: expanded && isPast,
    staleTime: 60 * 60 * 1000,
  });

  const dateStr = new Date(race.date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  });

  return (
    <View style={styles.raceCard}>
      <TouchableOpacity
        style={styles.raceCardHeader}
        onPress={() => isPast && setExpanded(e => !e)}
        activeOpacity={isPast ? 0.7 : 1}
      >
        <View style={[styles.roundBadge, !isPast && styles.roundBadgeFuture]}>
          <Text style={[styles.roundText, !isPast && styles.roundTextFuture]}>R{race.round}</Text>
        </View>
        <View style={styles.raceInfo}>
          <Text style={styles.raceName} numberOfLines={1}>{race.raceName}</Text>
          <Text style={styles.raceCountry}>
            {race.Circuit?.Location?.country ?? ''} · {dateStr}
          </Text>
        </View>
        {isPast && (
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        )}
        {!isPast && (
          <Text style={styles.upcoming}>UPCOMING</Text>
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.resultsBox}>
          {isLoading ? (
            <ActivityIndicator color={Colors.primary} size="small" style={{ padding: Spacing.md }} />
          ) : results?.length ? (
            results.slice(0, 10).map((r, i) => (
              <RaceResultRow key={r.Driver.driverId} result={r} index={i} />
            ))
          ) : (
            <Text style={styles.noResults}>Results not available yet</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── Races tab ──────────────────────────────────────────────────────────────────

function RacesTab() {
  const { data: schedule, isLoading } = useQuery({
    queryKey: ['schedule', YEAR],
    queryFn: () => history.schedule(YEAR),
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={schedule ?? []}
      keyExtractor={r => r.round}
      renderItem={({ item }) => <RaceCard race={item} />}
      contentContainerStyle={{ padding: Spacing.sm, paddingBottom: Spacing.xl }}
      ListHeaderComponent={
        <Text style={styles.sectionHeader}>{YEAR} RACE CALENDAR</Text>
      }
    />
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function Standings() {
  const [tab, setTab] = useState<Tab>('drivers');

  const { data: overview, isLoading } = useQuery({
    queryKey: ['season_overview', YEAR],
    queryFn: () => history.seasonOverview(YEAR),
    staleTime: 5 * 60 * 1000,
  });

  const driverStandings = overview?.driver_standings ?? [];
  const constructorStandings = overview?.constructor_standings ?? [];
  const maxDriverPoints = Math.max(...driverStandings.map(d => Number(d.points)), 1);
  const maxConstructorPoints = Math.max(...constructorStandings.map(c => Number(c.points)), 1);

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'drivers', label: 'WDC' },
    { id: 'constructors', label: 'WCC' },
    { id: 'races', label: 'RACES' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'races' ? (
        <RacesTab />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : tab === 'drivers' ? (
        <FlatList
          data={driverStandings}
          keyExtractor={item => item.Driver.driverId}
          renderItem={({ item }) => (
            <DriverStandingRow item={item} maxPoints={maxDriverPoints} />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionHeader}>{YEAR} DRIVERS' CHAMPIONSHIP</Text>
          }
          contentContainerStyle={styles.list}
        />
      ) : (
        <FlatList
          data={constructorStandings}
          keyExtractor={item => item.Constructor.name}
          renderItem={({ item }) => (
            <ConstructorStandingRow item={item} maxPoints={maxConstructorPoints} />
          )}
          ListHeaderComponent={
            <Text style={styles.sectionHeader}>{YEAR} CONSTRUCTORS' CHAMPIONSHIP</Text>
          }
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700', letterSpacing: 2 },
  tabTextActive: { color: Colors.primary },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingBottom: Spacing.xl },
  sectionHeader: {
    color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700',
    letterSpacing: 2, padding: Spacing.md, paddingBottom: Spacing.sm,
  },

  // Standings rows
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  position: { width: 28, color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  podium: { color: Colors.primary },
  driverInfo: { flex: 1 },
  name: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '700' },
  team: { color: Colors.textSecondary, fontSize: FontSize.xs, marginBottom: 4 },
  barContainer: {
    height: 4, backgroundColor: Colors.border, borderRadius: 2, maxWidth: 200, overflow: 'hidden',
  },
  bar: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
  pointsCol: { alignItems: 'flex-end', minWidth: 60 },
  points: { color: Colors.text, fontSize: FontSize.md, fontWeight: '900' },
  wins: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },

  // Race card
  raceCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xs, overflow: 'hidden',
  },
  raceCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.sm, gap: Spacing.sm,
  },
  roundBadge: {
    width: 36, height: 36, borderRadius: Radius.sm,
    backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary + '55',
    justifyContent: 'center', alignItems: 'center',
  },
  roundBadgeFuture: { backgroundColor: Colors.border, borderColor: 'transparent' },
  roundText: { color: Colors.primary, fontSize: 11, fontWeight: '900' },
  roundTextFuture: { color: Colors.textMuted },
  raceInfo: { flex: 1 },
  raceName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '700' },
  raceCountry: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  chevron: { color: Colors.textMuted, fontSize: 10 },
  upcoming: {
    color: Colors.textMuted, fontSize: 9, fontWeight: '700',
    letterSpacing: 1, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.xs,
  },

  // Race results
  resultsBox: { borderTopWidth: 1, borderTopColor: Colors.border },
  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '80',
  },
  resultPos: { width: 28, color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  resultInfo: { flex: 1 },
  resultDriver: { color: Colors.text, fontSize: 12, fontWeight: '700' },
  resultTeam: { color: Colors.textMuted, fontSize: 10 },
  resultRight: { alignItems: 'flex-end' },
  resultPoints: { color: Colors.text, fontSize: 11, fontWeight: '700' },
  resultStatus: { color: Colors.textMuted, fontSize: 9, maxWidth: 80 },
  noResults: {
    color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center', padding: Spacing.md,
  },
});
