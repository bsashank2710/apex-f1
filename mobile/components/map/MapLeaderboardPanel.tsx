import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import type { LeaderboardRow } from '../../lib/f1RaceVisualization';
import { Colors, Spacing, FontSize, Radius } from '../../constants/theme';

const PODIUM = {
  1: { ring: '#ffd700', glow: '#ffd70044', label: 'P1' },
  2: { ring: '#e8e8e8', glow: '#ffffff33', label: 'P2' },
  3: { ring: '#cd7f32', glow: '#cd7f3233', label: 'P3' },
} as const;

export function MapLeaderboardPanel({
  rows,
  selectedDriverNumber,
  onSelectDriver,
  sessionLabel,
}: {
  rows: LeaderboardRow[];
  selectedDriverNumber: number | null;
  onSelectDriver: (dn: number | null) => void;
  sessionLabel?: string;
}) {
  if (!rows.length) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>RUNNING ORDER</Text>
        {sessionLabel ? <Text style={styles.sub}>{sessionLabel}</Text> : null}
      </View>
      <ScrollView style={styles.scroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {rows.map((r) => {
          const pod = PODIUM[r.position as 1 | 2 | 3];
          const active = selectedDriverNumber === r.driver_number;
          return (
            <TouchableOpacity
              key={r.driver_number}
              style={[
                styles.row,
                pod && { borderColor: pod.ring + '88', backgroundColor: pod.glow },
                active && styles.rowActive,
              ]}
              onPress={() => onSelectDriver(active ? null : r.driver_number)}
              activeOpacity={0.85}
            >
              <View style={[styles.pos, pod && { borderColor: pod.ring }]}>
                <Text style={[styles.posTxt, pod && { color: pod.ring }]}>{r.position}</Text>
              </View>
              <View style={[styles.stripe, { backgroundColor: r.team_hex }]} />
              <View style={styles.main}>
                <View style={styles.codeRow}>
                  <View style={[styles.teamDot, { backgroundColor: r.team_hex }]} />
                  <Text style={styles.code}>{r.code}</Text>
                  {pod && <Text style={[styles.pill, { color: pod.ring }]}>{pod.label}</Text>}
                </View>
                <Text style={styles.team} numberOfLines={1}>{r.team_name || '—'}</Text>
              </View>
              <View style={styles.gaps}>
                <Text style={styles.gapMain}>{r.gap_to_leader}</Text>
                <Text style={styles.gapSub}>{r.interval}</Text>
                {r.compound ? <Text style={styles.tyre}>{r.compound}</Text> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 340,
    maxHeight: 420,
    backgroundColor: '#06060e',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#00f5ff22',
    overflow: 'hidden',
  },
  head: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#080812',
  },
  title: {
    color: '#00f5ff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  scroll: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  rowActive: {
    backgroundColor: Colors.primary + '18',
    borderLeftColor: Colors.primary,
  },
  pos: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingVertical: 4,
  },
  posTxt: { color: Colors.text, fontSize: 12, fontWeight: '900' },
  stripe: { width: 3, alignSelf: 'stretch', marginHorizontal: 6, borderRadius: 2, backgroundColor: '#222' },
  main: { flex: 1, minWidth: 0 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  code: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 1 },
  pill: { fontSize: 9, fontWeight: '800', marginLeft: 4 },
  team: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  gaps: { alignItems: 'flex-end', minWidth: 72 },
  gapMain: { color: Colors.text, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  gapSub: { color: Colors.textMuted, fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] },
  tyre: { color: Colors.soft, fontSize: 9, marginTop: 2, fontWeight: '700' },
});
