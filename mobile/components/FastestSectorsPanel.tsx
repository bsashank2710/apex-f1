/**
 * Fastest sector times for the current OpenF1 session — broadcast-style table + map sync.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { coerceDriverNumber, type Driver, type Lap } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

export const SECTOR_VISUAL_COLORS = {
  1: '#E31937',
  2: '#00D4E0',
  3: '#F5C400',
} as const;

export type SectorId = 1 | 2 | 3;

export interface SectorBestRow {
  sector: SectorId;
  seconds: number | null;
  driver: Driver | null;
}

function formatSectorTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  return seconds.toFixed(3);
}

function splitName(full?: string, acronym?: string): { given: string; surname: string } {
  const raw = (full ?? '').trim();
  if (raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return { given: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1].toUpperCase() };
    }
    return { given: '', surname: raw.toUpperCase() };
  }
  return { given: '', surname: (acronym ?? '—').toUpperCase() };
}

/** Merge `/drivers` with lap-only driver numbers so sector rows always resolve a label. */
export function buildDriverLookupForSession(
  laps: Lap[] | undefined,
  drivers: Driver[] | undefined,
): Map<number, Driver> {
  const m = new Map<number, Driver>();
  for (const d of drivers ?? []) {
    const n = coerceDriverNumber(d.driver_number);
    if (n != null) m.set(n, d);
  }
  for (const l of laps ?? []) {
    const n = coerceDriverNumber(l.driver_number);
    if (n != null && !m.has(n)) {
      m.set(n, {
        driver_number: n,
        name_acronym: String(n),
        full_name: `Driver ${n}`,
        team_name: '—',
      });
    }
  }
  return m;
}

/** Parse a positive sector time from OpenF1 / proxies (strings, alternate keys). */
function readPositiveSectorSeconds(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 600) return undefined;
  return n;
}

/** Sector durations from a lap row — supports snake_case, camelCase, string numbers. */
export function lapSectorSecondsFromRow(l: Lap | Record<string, unknown>): {
  s1?: number;
  s2?: number;
  s3?: number;
} {
  const r = l as Record<string, unknown>;
  return {
    s1: readPositiveSectorSeconds(
      r.duration_sector_1 ?? r.durationSector1 ?? r.sector_1_duration ?? r.sector1Duration,
    ),
    s2: readPositiveSectorSeconds(
      r.duration_sector_2 ?? r.durationSector2 ?? r.sector_2_duration ?? r.sector2Duration,
    ),
    s3: readPositiveSectorSeconds(
      r.duration_sector_3 ?? r.durationSector3 ?? r.sector_3_duration ?? r.sector3Duration,
    ),
  };
}

function lapIsPitOutRow(l: Lap | Record<string, unknown>): boolean {
  const r = l as Record<string, unknown>;
  return r.is_pit_out_lap === true || r.isPitOutLap === true || r.pit_out_lap === true;
}

/** Best sector time per segment across all laps (skips pit-out). */
export function computeSectorBests(laps: Lap[] | undefined, driverLookup: Map<number, Driver>): SectorBestRow[] {
  let b1 = { t: Number.POSITIVE_INFINITY, dn: 0 };
  let b2 = { t: Number.POSITIVE_INFINITY, dn: 0 };
  let b3 = { t: Number.POSITIVE_INFINITY, dn: 0 };

  for (const l of laps ?? []) {
    if (lapIsPitOutRow(l)) continue;
    const r  = l as unknown as Record<string, unknown>;
    const dn = coerceDriverNumber(r.driver_number ?? r.driverNumber) ?? 0;
    if (!dn) continue;
    const { s1, s2, s3 } = lapSectorSecondsFromRow(l);
    if (s1 != null && s1 < b1.t) b1 = { t: s1, dn };
    if (s2 != null && s2 < b2.t) b2 = { t: s2, dn };
    if (s3 != null && s3 < b3.t) b3 = { t: s3, dn };
  }

  const row = (sector: SectorId, b: { t: number; dn: number }): SectorBestRow => {
    if (!Number.isFinite(b.t) || b.t === Number.POSITIVE_INFINITY) {
      return { sector, seconds: null, driver: null };
    }
    return { sector, seconds: b.t, driver: driverLookup.get(b.dn) ?? null };
  };

  return [row(1, b1), row(2, b2), row(3, b3)];
}

export function FastestSectorsPanel({
  rows,
  selectedSector,
  onSelectSector,
  loading,
  qualifyingMode = false,
}: {
  rows: SectorBestRow[];
  selectedSector: SectorId | null;
  onSelectSector: (s: SectorId | null) => void;
  loading?: boolean;
  /** When true, explain that S1–S3 are lap micro-sectors, not Q1/Q2/Q3. */
  qualifyingMode?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>FASTEST TRACK SECTORS</Text>
        <Text style={styles.cardHint}>Tap a row or the map</Text>
      </View>
      {qualifyingMode && (
        <Text style={styles.qualiClarify}>
          S1 · S2 · S3 = three splits on every flying lap (timing loop). They are not the same as qualifying sessions Q1, Q2, and Q3.
        </Text>
      )}

      <View style={styles.chips}>
        {([1, 2, 3] as const).map((id) => (
          <TouchableOpacity
            key={id}
            style={[
              styles.chip,
              { borderColor: SECTOR_VISUAL_COLORS[id] },
              selectedSector === id && {
                backgroundColor: SECTOR_VISUAL_COLORS[id] + '18',
                borderWidth: 1.5,
              },
            ]}
            onPress={() => onSelectSector(selectedSector === id ? null : id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipTxt, selectedSector === id && styles.chipTxtActive]}>S{id}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.chipClear} onPress={() => onSelectSector(null)}>
          <Text style={styles.chipClearTxt}>ALL</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingTxt}>Loading sector times…</Text>
        </View>
      )}

      <View style={styles.tableHead}>
        <Text style={[styles.th, { flex: 0.22 }]}>SPLIT</Text>
        <Text style={[styles.th, { flex: 0.38 }]}>DRIVER</Text>
        <Text style={[styles.th, { flex: 0.28 }]}>TEAM</Text>
        <Text style={[styles.th, { flex: 0.12, textAlign: 'right' }]}>TIME</Text>
      </View>

      {rows.map((r) => {
        const c = SECTOR_VISUAL_COLORS[r.sector];
        const active = selectedSector === r.sector;
        const { given, surname } = splitName(r.driver?.full_name, r.driver?.name_acronym);
        const team = r.driver?.team_name ?? '—';
        const teamHex = r.driver?.team_colour ? `#${r.driver.team_colour}` : Colors.textMuted;

        return (
          <TouchableOpacity
            key={r.sector}
            style={[styles.row, active && styles.rowActive]}
            onPress={() => onSelectSector(active ? null : r.sector)}
            activeOpacity={0.75}
          >
            <View style={[styles.sectorBar, { backgroundColor: c }]} />
            <View style={styles.rowInner}>
              <Text style={[styles.tdSector, { color: c }]}>S{r.sector}</Text>
              <View style={styles.driverCell}>
                {given ? (
                  <Text style={styles.driverLine}>
                    <Text style={styles.driverGiven}>{given.toUpperCase()} </Text>
                    <Text style={styles.driverSurname}>{surname}</Text>
                  </Text>
                ) : (
                  <Text style={styles.driverSurname}>{surname}</Text>
                )}
              </View>
              <View style={styles.teamCell}>
                <View style={[styles.teamDot, { backgroundColor: teamHex }]} />
                <Text style={styles.teamTxt} numberOfLines={1}>{team}</Text>
              </View>
              <Text style={styles.timeTxt}>{formatSectorTime(r.seconds)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
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
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '900',
    letterSpacing: 2,
  },
  cardHint: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  qualiClarify: {
    color: Colors.soft,
    fontSize: 10,
    lineHeight: 15,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    letterSpacing: 0.2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    backgroundColor: Colors.background,
  },
  chipTxt: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  chipTxtActive: { color: Colors.text },
  chipClear: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  chipClearTxt: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  loadingTxt: { color: Colors.textMuted, fontSize: 12 },
  tableHead: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  th: { color: Colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowActive: { backgroundColor: 'rgba(26, 26, 34, 0.55)' },
  sectorBar: { width: 4 },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    gap: 4,
  },
  tdSector: { flex: 0.22, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  driverCell: { flex: 0.38 },
  driverGiven: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  driverSurname: { color: Colors.text, fontSize: 12, fontWeight: '900' },
  teamCell: { flex: 0.28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamDot: { width: 8, height: 8, borderRadius: 4 },
  teamTxt: { flex: 1, color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },
  timeTxt: {
    flex: 0.12,
    textAlign: 'right',
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  driverLine: { flexWrap: 'wrap' as const },
});
