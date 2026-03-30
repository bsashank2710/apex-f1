import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Pressable,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../../lib/api';
import type { Driver, Lap } from '../../lib/api';
import { sectorHighlights, type SectorHighlight } from '../../lib/f1RaceVisualization';
import { Colors, Spacing, FontSize, Radius } from '../../constants/theme';

function fmtSec(s?: number | null): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return '—';
  return s.toFixed(3);
}

const SECTOR_COL: Record<SectorHighlight, string> = {
  none: Colors.text,
  personal_best: '#39B54A',
  overall_fastest: '#9B59B6',
};

function SectorChip({ label, sec, hi }: { label: string; sec: string; hi: SectorHighlight }) {
  return (
    <View style={[styles.sectorChip, hi !== 'none' && { borderColor: SECTOR_COL[hi] }]}>
      <Text style={styles.sectorLbl}>{label}</Text>
      <Text style={[styles.sectorVal, { color: SECTOR_COL[hi] }]}>{sec}</Text>
    </View>
  );
}

export function DriverTelemetryDrawer({
  visible,
  onClose,
  sessionKey,
  driver,
  allSessionLaps,
}: {
  visible: boolean;
  onClose: () => void;
  sessionKey: string | number;
  driver: Driver | null;
  /** All drivers’ laps (e.g. map query) — needed for purple “session fastest” sectors. */
  allSessionLaps?: Lap[];
}) {
  const dn = driver?.driver_number;

  const { data: carRows } = useQuery({
    queryKey: ['car_data', 'drawer', sessionKey, dn],
    queryFn: () => live.carData(sessionKey, dn!),
    enabled: visible && dn != null,
    refetchInterval: visible ? 2000 : false,
  });

  const { data: laps } = useQuery({
    queryKey: ['laps', 'drawer', sessionKey, dn],
    queryFn: () => live.laps(sessionKey, dn!),
    enabled: visible && dn != null,
    refetchInterval: visible ? 5000 : false,
  });

  const latest = useMemo(() => pickLatestLap(laps), [laps]);
  const sessionBests = useMemo(
    () => (allSessionLaps?.length ? sessionFastestSectors(allSessionLaps) : {}),
    [allSessionLaps],
  );
  const pb = useMemo(() => personalBestsForDriver(laps, dn), [laps, dn]);

  const [h1, h2, h3] = sectorHighlights({
    s1: latest?.duration_sector_1,
    s2: latest?.duration_sector_2,
    s3: latest?.duration_sector_3,
    fastest_s1: sessionBests.s1,
    fastest_s2: sessionBests.s2,
    fastest_s3: sessionBests.s3,
    pb_s1: pb.s1,
    pb_s2: pb.s2,
    pb_s3: pb.s3,
  });

  const snap = carRows?.length ? carRows[carRows.length - 1] : null;

  if (!driver) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.hero}>
            <View style={[styles.heroDot, { backgroundColor: driver.team_colour ? `#${driver.team_colour}` : Colors.primary }]} />
            <View>
              <Text style={styles.name}>{driver.full_name ?? driver.name_acronym}</Text>
              <Text style={styles.meta}>{driver.team_name ?? ''}</Text>
            </View>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>LIVE</Text>
            <View style={styles.grid}>
              <Metric label="SPEED" value={snap?.speed != null ? `${snap.speed}` : '—'} unit="km/h" accent />
              <Metric label="GEAR" value={snap?.n_gear != null ? String(snap.n_gear) : '—'} unit="" />
              <Metric label="THROTTLE" value={snap?.throttle != null ? `${snap.throttle}` : '—'} unit="%" />
              <Metric label="DRS" value={snap?.drs != null ? String(snap.drs) : '—'} unit="" />
            </View>

            <Text style={styles.section}>LAST LAP · SECTORS</Text>
            <View style={styles.sectorRow}>
              <SectorChip label="S1" sec={fmtSec(latest?.duration_sector_1)} hi={h1} />
              <SectorChip label="S2" sec={fmtSec(latest?.duration_sector_2)} hi={h2} />
              <SectorChip label="S3" sec={fmtSec(latest?.duration_sector_3)} hi={h3} />
            </View>
            <Text style={styles.lapTime}>
              LAP TIME <Text style={styles.lapTimeVal}>{fmtSec(latest?.lap_duration)}</Text>
            </Text>
            {driver.compound && (
              <Text style={styles.tyreLine}>TYRE {driver.compound}{driver.tyre_age != null ? ` · ${driver.tyre_age}L` : ''}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Metric({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <View style={[styles.metric, accent && styles.metricAccent]}>
      <Text style={styles.metricLbl}>{label}</Text>
      <Text style={[styles.metricVal, accent && { color: '#00f5ff' }]}>
        {value}{unit ? <Text style={styles.metricUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function pickLatestLap(laps: Lap[] | undefined): Lap | null {
  if (!laps?.length) return null;
  let best: Lap | null = null;
  let bestN = -1;
  for (const l of laps) {
    const n = l.lap_number ?? 0;
    if (n >= bestN) {
      bestN = n;
      best = l;
    }
  }
  return best;
}

function sessionFastestSectors(laps: Lap[] | undefined): { s1?: number; s2?: number; s3?: number } {
  if (!laps?.length) return {};
  let s1 = Infinity, s2 = Infinity, s3 = Infinity;
  for (const l of laps) {
    if (l.is_pit_out_lap) continue;
    if (l.duration_sector_1 && l.duration_sector_1 > 0 && l.duration_sector_1 < s1) s1 = l.duration_sector_1;
    if (l.duration_sector_2 && l.duration_sector_2 > 0 && l.duration_sector_2 < s2) s2 = l.duration_sector_2;
    if (l.duration_sector_3 && l.duration_sector_3 > 0 && l.duration_sector_3 < s3) s3 = l.duration_sector_3;
  }
  return {
    s1: s1 < Infinity ? s1 : undefined,
    s2: s2 < Infinity ? s2 : undefined,
    s3: s3 < Infinity ? s3 : undefined,
  };
}

function personalBestsForDriver(laps: Lap[] | undefined, dn: number | undefined) {
  const out = { s1: undefined as number | undefined, s2: undefined as number | undefined, s3: undefined as number | undefined };
  if (!laps || dn == null) return out;
  let s1 = Infinity, s2 = Infinity, s3 = Infinity;
  for (const l of laps) {
    if (l.driver_number !== dn || l.is_pit_out_lap) continue;
    if (l.duration_sector_1 && l.duration_sector_1 > 0 && l.duration_sector_1 < s1) s1 = l.duration_sector_1;
    if (l.duration_sector_2 && l.duration_sector_2 > 0 && l.duration_sector_2 < s2) s2 = l.duration_sector_2;
    if (l.duration_sector_3 && l.duration_sector_3 > 0 && l.duration_sector_3 < s3) s3 = l.duration_sector_3;
  }
  return {
    s1: s1 < Infinity ? s1 : undefined,
    s2: s2 < Infinity ? s2 : undefined,
    s3: s3 < Infinity ? s3 : undefined,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#07070f',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#00f5ff33',
    maxHeight: '72%',
    paddingBottom: Spacing.xl,
  },
  handleRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 8, paddingHorizontal: Spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#333' },
  close: { position: 'absolute', right: Spacing.md, color: Colors.textMuted, fontSize: 18, fontWeight: '700' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  heroDot: { width: 14, height: 14, borderRadius: 7 },
  name: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '900' },
  meta: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  body: { paddingHorizontal: Spacing.lg },
  section: { color: '#00f5ff', fontSize: 9, fontWeight: '900', letterSpacing: 2, marginTop: Spacing.md, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    width: '47%',
    backgroundColor: '#10101a',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricAccent: { borderColor: '#00f5ff44' },
  metricLbl: { color: Colors.textMuted, fontSize: 9, fontWeight: '800' },
  metricVal: { color: Colors.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  metricUnit: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  sectorRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sectorChip: {
    flex: 1,
    minWidth: 90,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#10101a',
  },
  sectorLbl: { color: Colors.textMuted, fontSize: 9, fontWeight: '800' },
  sectorVal: { fontSize: 16, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  lapTime: { color: Colors.textMuted, fontSize: 11, marginTop: Spacing.md, fontWeight: '700' },
  lapTimeVal: { color: Colors.text, fontSize: 18, fontWeight: '900' },
  tyreLine: { color: Colors.soft, fontSize: 12, fontWeight: '800', marginTop: Spacing.sm, marginBottom: Spacing.lg },
});
