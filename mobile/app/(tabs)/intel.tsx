/**
 * APEX AI INTEL — Post-race intelligence powered by Claude.
 * Shows driver mistakes, strategy analysis, what-ifs, and
 * championship impact for the most recent (or selected) race.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Animated, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { history, ai } from '../../lib/api';
import type { PostRaceIntelDriverAnalysis, ErgastRace, PostRaceIntel } from '../../lib/api';
import { Colors } from '../../constants/theme';

/** World Championship seasons with Ergast-style data (1950 → current). */
function seasonYearsDescending(): string[] {
  const y = new Date().getFullYear();
  const out: string[] = [];
  for (let yr = y; yr >= 1950; yr--) out.push(String(yr));
  return out;
}

// ── Grade colour map ──────────────────────────────────────────────────────────
const GRADE_COLOR: Record<string, string> = {
  S: '#FFD700', A: '#00E5A0', B: '#4FC3F7', C: '#FF8C00', D: '#E53935',
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string }) {
  const color = GRADE_COLOR[grade] ?? '#888';
  return (
    <View style={[gb.wrap, { borderColor: color }]}>
      <Text style={[gb.letter, { color }]}>{grade}</Text>
    </View>
  );
}
const gb = StyleSheet.create({
  wrap: { width: 44, height: 44, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 22, fontWeight: '900' },
});

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? '#00E5A0' : score >= 60 ? '#FFD700' : '#FF8C00';
  return (
    <View style={sb.track}>
      <View style={[sb.fill, { width: `${score}%` as any, backgroundColor: color }]} />
    </View>
  );
}
const sb = StyleSheet.create({
  track: { height: 3, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden', flex: 1 },
  fill:  { height: '100%', borderRadius: 2 },
});

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sh.row}>
      <Text style={sh.icon}>{icon}</Text>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}
const sh = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 24 },
  icon:  { fontSize: 16 },
  title: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 3 },
});

function DriverCard({ d }: { d: PostRaceIntelDriverAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const scoreColor = d.score >= 80 ? '#00E5A0' : d.score >= 60 ? '#FFD700' : '#FF8C00';
  const posChange  = d.grid - d.finish;

  return (
    <TouchableOpacity style={dc.card} onPress={() => setExpanded(e => !e)} activeOpacity={0.85}>
      <View style={dc.header}>
        <View style={dc.codeWrap}>
          <Text style={dc.code}>{d.driver_code}</Text>
          <Text style={dc.name}>{d.driver_name}</Text>
        </View>
        <View style={dc.right}>
          <View style={dc.posRow}>
            <Text style={dc.posLabel}>P{d.grid}</Text>
            <Text style={dc.arrow}> → </Text>
            <Text style={[dc.posLabel, { color: '#fff' }]}>P{d.finish}</Text>
            {posChange !== 0 && (
              <Text style={[dc.delta, { color: posChange > 0 ? '#00E5A0' : '#E53935' }]}>
                {posChange > 0 ? `+${posChange}` : posChange}
              </Text>
            )}
          </View>
          <View style={dc.scoreRow}>
            <ScoreBar score={d.score} />
            <Text style={[dc.scoreNum, { color: scoreColor }]}>{d.score}</Text>
          </View>
        </View>
      </View>

      {expanded && (
        <View style={dc.body}>
          {d.highlights.length > 0 && (
            <View style={dc.section}>
              <Text style={dc.sectionLabel}>HIGHLIGHTS</Text>
              {d.highlights.map((h, i) => (
                <View key={i} style={dc.bullet}>
                  <Text style={dc.dot}>✦</Text>
                  <Text style={dc.bulletText}>{h}</Text>
                </View>
              ))}
            </View>
          )}
          {d.mistakes.length > 0 && (
            <View style={dc.section}>
              <Text style={[dc.sectionLabel, { color: '#FF8C00' }]}>MISTAKES</Text>
              {d.mistakes.map((m, i) => (
                <View key={i} style={dc.bullet}>
                  <Text style={[dc.dot, { color: '#FF8C00' }]}>!</Text>
                  <Text style={dc.bulletText}>{m}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={dc.tipBox}>
            <Text style={dc.tipLabel}>AI TIP</Text>
            <Text style={dc.tipText}>{d.tip}</Text>
          </View>
        </View>
      )}

      <Text style={dc.chevron}>{expanded ? '▲' : '▼'}</Text>
    </TouchableOpacity>
  );
}
const dc = StyleSheet.create({
  card:       { backgroundColor: '#0E0E16', borderWidth: 1, borderColor: '#1e1e2e', borderRadius: 10, padding: 14, marginBottom: 8 },
  header:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  codeWrap:   { width: 52 },
  code:       { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  name:       { color: Colors.textMuted, fontSize: 9, marginTop: 2, letterSpacing: 0.5 },
  right:      { flex: 1, gap: 6 },
  posRow:     { flexDirection: 'row', alignItems: 'center' },
  posLabel:   { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  arrow:      { color: Colors.textMuted, fontSize: 11 },
  delta:      { fontSize: 11, fontWeight: '900', marginLeft: 4 },
  scoreRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreNum:   { fontSize: 11, fontWeight: '900', width: 24, textAlign: 'right' },
  body:       { marginTop: 12, borderTopWidth: 1, borderTopColor: '#1e1e2e', paddingTop: 12, gap: 10 },
  section:    { gap: 4 },
  sectionLabel: { color: '#00E5A0', fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 4 },
  bullet:     { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  dot:        { color: '#00E5A0', fontSize: 10, marginTop: 1 },
  bulletText: { color: '#aaa', fontSize: 12, lineHeight: 18, flex: 1 },
  tipBox:     { backgroundColor: '#0a1a12', borderLeftWidth: 2, borderLeftColor: '#00E5A0', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4 },
  tipLabel:   { color: '#00E5A0', fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 3 },
  tipText:    { color: '#ccc', fontSize: 12, lineHeight: 18 },
  chevron:    { color: Colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 4 },
});

function WhatIfCard({ text, index }: { text: string; index: number }) {
  return (
    <View style={wif.card}>
      <View style={wif.numWrap}><Text style={wif.num}>0{index + 1}</Text></View>
      <Text style={wif.text}>{text}</Text>
    </View>
  );
}
const wif = StyleSheet.create({
  card:   { flexDirection: 'row', gap: 12, backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 8, padding: 14, marginBottom: 8, alignItems: 'flex-start' },
  numWrap: { width: 24, height: 24, borderRadius: 4, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  num:    { color: Colors.primary, fontSize: 10, fontWeight: '900' },
  text:   { flex: 1, color: '#bbb', fontSize: 13, lineHeight: 20 },
});

// ── Season + race pickers ─────────────────────────────────────────────────────

function YearStrip({
  years,
  selected,
  onSelect,
}: {
  years: string[];
  selected: string;
  onSelect: (y: string) => void;
}) {
  return (
    <View style={ys.wrap}>
      <Text style={ys.label}>SEASON</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ys.row}>
        {years.map(y => {
          const active = selected === y;
          return (
            <TouchableOpacity
              key={y}
              style={[ys.chip, active && ys.chipActive]}
              onPress={() => onSelect(y)}
              activeOpacity={0.75}
            >
              <Text style={[ys.chipTxt, active && ys.chipTxtActive]}>{y}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
const ys = StyleSheet.create({
  wrap:  { marginHorizontal: -16, marginBottom: 10 },
  label: { color: Colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 2, paddingHorizontal: 16, marginBottom: 6 },
  row:   { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  chip:  { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0a0a14' },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '18' },
  chipTxt:    { color: Colors.textMuted, fontSize: 13, fontWeight: '800' },
  chipTxtActive: { color: '#fff' },
});

function RacePicker({
  schedule,
  latestActive,
  onSelectLatest,
  selected,
  onSelect,
}: {
  schedule: ErgastRace[];
  latestActive: boolean;
  onSelectLatest: () => void;
  selected: ErgastRace | null;
  onSelect: (r: ErgastRace) => void;
}) {
  const past = schedule
    .filter(r => new Date(r.date) <= new Date())
    .reverse();

  return (
    <View style={rp.wrap}>
      <Text style={rp.label}>RACES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rp.row}>
        <TouchableOpacity
          style={[rp.chip, rp.chipLatest, latestActive && rp.chipActive]}
          onPress={onSelectLatest}
          activeOpacity={0.75}
        >
          <Text style={[rp.chipRound, latestActive && rp.chipRoundActive]}>LATEST</Text>
          <Text style={[rp.chipName, latestActive && rp.chipNameActive]} numberOfLines={1}>
            Last completed
          </Text>
        </TouchableOpacity>
        {past.map(r => {
          const active = !latestActive && selected?.season === r.season && selected?.round === r.round;
          return (
            <TouchableOpacity
              key={`${r.season}-${r.round}`}
              style={[rp.chip, active && rp.chipActive]}
              onPress={() => onSelect(r)}
              activeOpacity={0.75}
            >
              <Text style={[rp.chipRound, active && rp.chipRoundActive]}>R{r.round}</Text>
              <Text style={[rp.chipName, active && rp.chipNameActive]} numberOfLines={1}>
                {r.Circuit?.Location?.country ?? r.raceName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
const rp = StyleSheet.create({
  wrap: { marginHorizontal: -16, marginBottom: 4 },
  label: { color: Colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 2, paddingHorizontal: 16, marginBottom: 6 },
  row:  { paddingHorizontal: 16, gap: 8, paddingVertical: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1e1e2e', backgroundColor: '#0a0a14', alignItems: 'center', minWidth: 72 },
  chipLatest: { minWidth: 88, borderColor: '#2a2030' },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '18' },
  chipRound:  { color: Colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  chipRoundActive: { color: Colors.primary },
  chipName:   { color: Colors.textMuted, fontSize: 10, fontWeight: '700', marginTop: 2, maxWidth: 80 },
  chipNameActive: { color: '#fff' },
});

function formatIntelErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  const lower = raw.toLowerCase();
  if (lower.includes('credit') || lower.includes('billing')) {
    return 'Your Claude API account has no credits.\nAdd credits at console.anthropic.com/settings/billing';
  }
  if (
    raw.includes('ANTHROPIC_API_KEY')
    || lower.includes('anthropic_api_key')
    || (lower.includes('503') && lower.includes('anthropic'))
  ) {
    return (
      'No Claude key reached the API. Do one of the following, then tap RETRY:\n\n'
      + '1) In mobile/.env set EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-... (no quotes around the value). '
      + 'Run `npx expo start --clear` from the mobile folder.\n\n'
      + '2) Web fallback: open DevTools console and run:\n'
      + `   localStorage.setItem('APEX_ANTHROPIC_KEY', 'sk-ant-your-key'); location.reload()\n\n`
      + '3) Or set ANTHROPIC_API_KEY on your API host (Cloud Run → Variables).'
    );
  }
  if (
    lower.includes('no session data')
    || lower.includes('no race data found')
    || (lower.includes('404') && (lower.includes('race') || lower.includes('session')))
  ) {
    return (
      'No qualifying, sprint, or race data is published for this round yet.\n\n'
      + 'Pick **LATEST · Last completed** or a round that has at least qualifying in the database, then tap RETRY.'
    );
  }
  return raw || 'Failed to generate intel';
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function IntelScreen() {
  const { width } = useWindowDimensions();
  const contentMaxStyle = useMemo(
    () => ({
      padding: 16,
      alignSelf: 'center' as const,
      width: '100%' as const,
      maxWidth: Math.min(Math.max(320, width - 24), 1200),
    }),
    [width],
  );
  const seasonYears = useMemo(() => seasonYearsDescending(), []);
  const queryClient = useQueryClient();

  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedRace, setSelectedRace] = useState<ErgastRace | null>(null);
  /** Ergast `current` / `last` — no waiting on season schedule. */
  const [useLatestMode, setUseLatestMode] = useState(true);

  const { data: schedule, isLoading: scheduleLoading } = useQuery({
    queryKey: ['schedule', selectedYear],
    queryFn: () => history.schedule(selectedYear),
    staleTime: 60 * 60 * 1000,
  });

  const pastRaces = useMemo(
    () => (schedule ?? []).filter(r => new Date(r.date) <= new Date()),
    [schedule],
  );
  const defaultRace = pastRaces[pastRaces.length - 1] ?? null;

  useEffect(() => {
    setSelectedRace(null);
  }, [selectedYear]);

  const race = selectedRace ?? defaultRace;
  const pickerRace = useLatestMode ? null : race;

  const intelYear = useLatestMode ? 'current' : String(race?.season ?? selectedYear);
  const intelRound = useLatestMode ? 'last' : String(race?.round ?? 'last');
  const intelEnabled = useLatestMode || (!!race && (schedule?.length ?? 0) > 0);

  const { data: intel, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['post_race_intel', intelYear, intelRound],
    queryFn: () => ai.postRaceIntel(intelYear, intelRound),
    enabled: intelEnabled,
    staleTime: useLatestMode ? 90 * 1000 : 30 * 60 * 1000,
    retry: 1,
  });

  useFocusEffect(
    useCallback(() => {
      if (!useLatestMode) return;
      void queryClient.invalidateQueries({ queryKey: ['post_race_intel', 'current', 'last'] });
    }, [useLatestMode, queryClient]),
  );

  const displayRaceName =
    useLatestMode
      ? (defaultRace?.raceName ?? 'Latest completed race')
      : (race?.raceName ?? `Round ${intelRound}`);

  const gradeColor = GRADE_COLOR[intel?.race_grade ?? ''] ?? '#888';
  const intelErrorText = useMemo(() => formatIntelErrorMessage(error), [error]);

  return (
    <View style={s.root}>
      {/* Fixed header */}
      <View style={s.topBar}>
        <View style={s.topLeft}>
          <Text style={s.aiLabel}>AI INTEL</Text>
          <View style={s.poweredRow}>
            <View style={s.pulseDot} />
            <Text style={s.poweredText}>POWERED BY APEX AI</Text>
          </View>
        </View>
        {isFetching && !intel ? (
          <ActivityIndicator color={Colors.primary} size="small" />
        ) : intel ? (
          <GradeBadge grade={intel.race_grade} />
        ) : null}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[contentMaxStyle, { paddingBottom: 48 }]}
        showsVerticalScrollIndicator={false}
      >
        <YearStrip
          years={seasonYears}
          selected={selectedYear}
          onSelect={y => {
            setSelectedYear(y);
            setUseLatestMode(false);
            setSelectedRace(null);
          }}
        />

        {scheduleLoading && (
          <View style={s.scheduleLoad}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={s.scheduleLoadTxt}>Loading {selectedYear} calendar…</Text>
          </View>
        )}

        {!scheduleLoading && schedule && schedule.length === 0 && (
          <Text style={s.emptySchedule}>No races found for {selectedYear}.</Text>
        )}

        <RacePicker
          schedule={schedule ?? []}
          latestActive={useLatestMode}
          onSelectLatest={() => {
            setUseLatestMode(true);
            setSelectedRace(null);
            setSelectedYear(String(new Date().getFullYear()));
          }}
          selected={pickerRace}
          onSelect={r => {
            setUseLatestMode(false);
            setSelectedRace(r);
            if (r.season) setSelectedYear(String(r.season));
          }}
        />

        {/* Loading — no placeholderData: old race intel must not stay visible under a new picker selection */}
        {isLoading && (
          <View style={s.loadBox}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={s.loadTitle}>Analyzing session data…</Text>
            <Text style={s.loadSub}>Claude is processing race, sprint, or{'\n'}qualifying data from the feed</Text>
          </View>
        )}

        {/* Error */}
        {isError && (
          <View style={s.errBox}>
            <Text style={s.errIcon}>⚠</Text>
            <Text style={s.errTitle}>Analysis Unavailable</Text>
            <Text style={s.errMsg}>{intelErrorText}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => refetch()}>
              <Text style={s.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Intel content */}
        {intel && (
          <>
            {/* Headline + summary */}
            <View style={s.headCard}>
              <Text style={s.raceName}>{displayRaceName}</Text>
              {intel.intel_basis && intel.intel_basis !== 'race' && intel.session_focus && (
                <View style={s.sessionChip}>
                  <Text style={s.sessionChipText}>
                    Based on {intel.session_focus}
                    {intel.intel_basis === 'qualifying' ? ' · GP not in database yet' : ''}
                  </Text>
                </View>
              )}
              <Text style={s.headline}>{intel.headline}</Text>
              <Text style={s.summary}>{intel.summary}</Text>
              <View style={[s.gradeRow, { borderTopColor: gradeColor + '40' }]}>
                <Text style={s.gradeLabel}>
                  {intel.intel_basis && intel.intel_basis !== 'race' ? 'SESSION GRADE' : 'RACE GRADE'}
                </Text>
                <Text style={[s.gradeValue, { color: gradeColor }]}>{intel.race_grade}</Text>
                <Text style={s.gradeReason}>{intel.grade_reason}</Text>
              </View>
            </View>

            {/* Driver Analysis */}
            <SectionHeader icon="◉" title="DRIVER ANALYSIS" />
            <Text style={s.hint}>Tap a driver card to expand</Text>
            {intel.driver_analysis.map(d => (
              <DriverCard key={d.driver_code} d={d} />
            ))}

            {/* Strategy Verdict */}
            <SectionHeader icon="◈" title="STRATEGY VERDICT" />
            <View style={s.stratCard}>
              <View style={s.stratRow}>
                <View style={s.stratHalf}>
                  <Text style={s.stratLabel}>BEST EXECUTED</Text>
                  <Text style={s.stratTeam}>{intel.strategy_verdict.best_team}</Text>
                </View>
                <View style={s.stratDivider} />
                <View style={s.stratHalf}>
                  <Text style={[s.stratLabel, { color: '#E53935' }]}>WORST EXECUTED</Text>
                  <Text style={s.stratTeam}>{intel.strategy_verdict.worst_team}</Text>
                </View>
              </View>
              <View style={s.insightBox}>
                <Text style={s.insightLabel}>KEY INSIGHT</Text>
                <Text style={s.insightText}>{intel.strategy_verdict.key_insight}</Text>
              </View>
              <Text style={s.pitAnalysis}>{intel.strategy_verdict.pit_analysis}</Text>
            </View>

            {/* What Ifs */}
            <SectionHeader icon="◆" title="WHAT IF?" />
            {intel.what_ifs.map((w, i) => (
              <WhatIfCard key={i} text={w} index={i} />
            ))}

            {/* Championship Impact */}
            <SectionHeader icon="▲" title="CHAMPIONSHIP IMPACT" />
            <View style={s.champCard}>
              <Text style={s.champText}>{intel.championship_impact}</Text>
            </View>

            <Text style={s.generatedAt}>
              Generated {new Date(intel.generated_at).toLocaleString()}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },

  scheduleLoad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 4 },
  scheduleLoadTxt: { color: Colors.textMuted, fontSize: 12 },
  emptySchedule: { color: Colors.textMuted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2a',
    backgroundColor: Colors.background,
  },
  topLeft:     { gap: 3 },
  aiLabel:     { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 3 },
  poweredRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulseDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  poweredText: { color: Colors.primary, fontSize: 9, fontWeight: '700', letterSpacing: 2 },

  loadBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  loadTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  loadSub:   { color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  errBox:  { alignItems: 'center', paddingVertical: 48, gap: 10 },
  errIcon: { fontSize: 32, color: '#E53935' },
  errTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  errMsg:   { color: '#666', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
  retryBtn: { marginTop: 8, borderWidth: 1, borderColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 4 },
  retryText: { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  headCard: {
    backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1e1e30',
    borderRadius: 12, padding: 16, marginBottom: 4, marginTop: 16,
  },
  raceName:  { color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  sessionChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 10,
  },
  sessionChipText: { color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  headline:  { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 28, marginBottom: 10 },
  summary:   { color: '#aaa', fontSize: 13, lineHeight: 21 },
  gradeRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  gradeLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 2 },
  gradeValue: { fontSize: 14, fontWeight: '900' },
  gradeReason: { flex: 1, color: '#777', fontSize: 11, lineHeight: 16 },

  hint: { color: '#333', fontSize: 10, marginBottom: 8, letterSpacing: 1 },

  stratCard: { backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1e1e30', borderRadius: 10, padding: 14 },
  stratRow:  { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stratHalf: { flex: 1, gap: 4 },
  stratDivider: { width: 1, backgroundColor: '#1e1e2e' },
  stratLabel: { color: '#00E5A0', fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  stratTeam:  { color: '#fff', fontSize: 13, fontWeight: '700' },
  insightBox: { backgroundColor: '#0d1a10', borderLeftWidth: 2, borderLeftColor: '#00E5A0', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, marginBottom: 10 },
  insightLabel: { color: '#00E5A0', fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 3 },
  insightText:  { color: '#ddd', fontSize: 13, lineHeight: 20 },
  pitAnalysis:  { color: '#888', fontSize: 12, lineHeight: 18 },

  champCard: { backgroundColor: '#0a0a14', borderWidth: 1, borderColor: '#1e1e30', borderRadius: 10, padding: 14 },
  champText:  { color: '#bbb', fontSize: 13, lineHeight: 21 },

  generatedAt: { color: Colors.textMuted, fontSize: 9, textAlign: 'center', marginTop: 20, letterSpacing: 1 },
});
