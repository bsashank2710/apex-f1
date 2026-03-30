/**
 * Ergast Q1 / Q2 / Q3 times for the selected Grand Prix weekend (grid order after quali).
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import type { ErgastQualifying } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

export function QualifyingResultsPanel({
  rows,
  loading,
  sprint,
}: {
  rows: ErgastQualifying[] | undefined;
  loading: boolean;
  sprint?: boolean;
}) {
  const label = sprint ? 'SPRINT SHOOTOUT / QUALIFYING' : 'QUALIFYING RESULTS';
  const qLabels = sprint ? (['SQ1', 'SQ2', 'SQ3'] as const) : (['Q1', 'Q2', 'Q3'] as const);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.hint}>Official times from the timing feed (Ergast)</Text>
      {loading && (
        <View style={styles.loadRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadTxt}>Loading grid…</Text>
        </View>
      )}
      {!loading && (!rows || rows.length === 0) && (
        <Text style={styles.empty}>No qualifying data for this round yet.</Text>
      )}
      {rows && rows.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
          <View>
            <View style={styles.headRow}>
              <Text style={[styles.th, styles.colPos]}>#</Text>
              <Text style={[styles.th, styles.colDriver]}>DRIVER</Text>
              <Text style={[styles.th, styles.colTeam]}>TEAM</Text>
              <Text style={[styles.th, styles.colQ]}>{qLabels[0]}</Text>
              <Text style={[styles.th, styles.colQ]}>{qLabels[1]}</Text>
              <Text style={[styles.th, styles.colQ]}>{qLabels[2]}</Text>
            </View>
            {rows.map((r, i) => (
              <View key={r.Driver?.driverId ?? `q-${i}`} style={styles.dataRow}>
                <Text style={[styles.td, styles.colPos]}>{r.position}</Text>
                <Text style={[styles.td, styles.colDriver]} numberOfLines={1}>
                  {r.Driver?.code ?? '—'}
                </Text>
                <Text style={[styles.tdMuted, styles.colTeam]} numberOfLines={1}>
                  {r.Constructor?.name ?? '—'}
                </Text>
                <Text style={[styles.td, styles.colQ]}>{r.Q1 ?? '—'}</Text>
                <Text style={[styles.td, styles.colQ]}>{r.Q2 ?? '—'}</Text>
                <Text style={[styles.td, styles.colQ]}>{r.Q3 ?? '—'}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingBottom: Spacing.sm,
    overflow: 'hidden',
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '900',
    letterSpacing: 2,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  hint: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  loadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  loadTxt: { color: Colors.textMuted, fontSize: 12 },
  empty: { color: Colors.textMuted, fontSize: 12, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  scroll: { maxHeight: 280 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  th: { color: Colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  td: { color: Colors.text, fontSize: 12, fontWeight: '700' },
  tdMuted: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  colPos: { width: 28, textAlign: 'center' },
  colDriver: { width: 44 },
  colTeam: { width: 120 },
  colQ: { width: 64, textAlign: 'right' },
});
