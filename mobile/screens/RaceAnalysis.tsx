/**
 * RaceAnalysis — Fastlytics-style premium race analytics.
 * Shown when there is no live session.
 * Tabs: RESULTS | QUALIFYING | STRATEGY | POSITIONS
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Svg, { Polyline, Line, Text as SvgText, Circle } from 'react-native-svg';
import { history } from '../lib/api';
import type {
  ErgastResult, ErgastQualifying, ErgastPitStop,
  LapDataPoint, FullRaceReport,
} from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

// ── Constants ──────────────────────────────────────────────────────────────────

type ReportTab = 'RESULTS' | 'QUALIFYING' | 'STRATEGY' | 'POSITIONS';

const TEAM_COLORS: Record<string, string> = {
  red_bull: Colors.redbull,
  ferrari: Colors.ferrari,
  mercedes: Colors.mercedes,
  mclaren: Colors.mclaren,
  alpine: Colors.alpine,
  aston_martin: Colors.astonMartin,
  williams: Colors.williams,
  haas: Colors.haas,
  sauber: Colors.sauber,
  rb: Colors.racingbulls,
  racing_bulls: Colors.racingbulls,
  kick_sauber: Colors.sauber,
  alphatauri: Colors.racingbulls,
  alfa: Colors.sauber,
};

const STINT_COLORS = [
  Colors.soft,
  Colors.medium,
  '#CCCCCC',
  Colors.soft,
  Colors.intermediate,
];

function getTeamColor(constructorId?: string): string {
  return TEAM_COLORS[constructorId ?? ''] ?? Colors.textMuted;
}

function parseQTime(t?: string): number | null {
  if (!t || t === '') return null;
  const parts = t.split(':');
  try {
    return parts.length === 2
      ? parseFloat(parts[0]) * 60 + parseFloat(parts[1])
      : parseFloat(t);
  } catch {
    return null;
  }
}

function formatDelta(secs: number, poleSecs: number): string {
  const d = secs - poleSecs;
  if (d <= 0.0005) return 'POLE';
  return `+${d.toFixed(3)}`;
}

// ── Hero cards ─────────────────────────────────────────────────────────────────

function HeroCard({
  label, icon, name, team, sub, color,
}: {
  label: string; icon: string;
  name?: string; team?: string; sub?: string; color?: string;
}) {
  return (
    <View style={[heroStyles.card, color ? { borderTopColor: color } : {}]}>
      <View style={heroStyles.topRow}>
        <Text style={heroStyles.label}>{label}</Text>
        <Text style={heroStyles.icon}>{icon}</Text>
      </View>
      <Text style={[heroStyles.name, color ? { color } : {}]} numberOfLines={1}>
        {name ?? '—'}
      </Text>
      <Text style={heroStyles.team} numberOfLines={1}>{team ?? ''}</Text>
      {sub && <Text style={heroStyles.sub}>{sub}</Text>}
    </View>
  );
}

function qualifyingSorted(qualifying: ErgastQualifying[]): ErgastQualifying[] {
  return [...qualifying].sort(
    (a, b) => parseInt(a.position, 10) - parseInt(b.position, 10),
  );
}

/** Best lap time in a qualifying segment (Q1 / Q2 / Q3). */
function fastestInSegment(
  qualifying: ErgastQualifying[],
  seg: 'Q1' | 'Q2' | 'Q3',
): ErgastQualifying | undefined {
  let best: ErgastQualifying | undefined;
  let bestT = Infinity;
  for (const q of qualifying) {
    const t = parseQTime(q[seg]);
    if (t != null && t < bestT) {
      bestT = t;
      best = q;
    }
  }
  return best;
}

function HeroCards({ results, qualifying }: {
  results: ErgastResult[]; qualifying: ErgastQualifying[];
}) {
  const qs = qualifying.length > 0 ? qualifyingSorted(qualifying) : [];

  if (results.length > 0) {
    const winner = results[0];
    const pole = qs[0];
    const fastest = results.find(r => r.FastestLap?.rank === '1');
    const winnerColor = getTeamColor(winner?.Constructor.constructorId);
    const poleColor = getTeamColor(pole?.Constructor.constructorId);
    const fastColor = getTeamColor(fastest?.Constructor.constructorId);
    return (
      <View style={heroStyles.row}>
        <HeroCard
          label="RACE WINNER"
          icon="🏆"
          name={winner?.Driver.code}
          team={winner?.Constructor.name}
          sub={winner?.Time?.time}
          color={winnerColor}
        />
        <HeroCard
          label="POLE POSITION"
          icon="⚡"
          name={pole?.Driver.code}
          team={pole?.Constructor.name}
          sub={pole?.Q3 ?? pole?.Q2 ?? pole?.Q1}
          color={poleColor}
        />
        <HeroCard
          label="FASTEST LAP"
          icon="⏱"
          name={fastest?.Driver.code}
          team={fastest?.Constructor.name}
          sub={fastest?.FastestLap?.Time.time}
          color={fastColor}
        />
      </View>
    );
  }

  if (qs.length > 0) {
    const pole = qs[0];
    const second = qs[1];
    const thirdGrid = qs[2];
    const fq1 = fastestInSegment(qualifying, 'Q1');
    const fq2 = fastestInSegment(qualifying, 'Q2');
    const poleCode = pole?.Driver.code;
    const third =
      fq1 && fq1.Driver.code !== poleCode
        ? { row: fq1, label: 'FASTEST Q1' as const, sub: fq1.Q1 }
        : fq2 && fq2.Driver.code !== poleCode
          ? { row: fq2, label: 'FASTEST Q2' as const, sub: fq2.Q2 }
          : thirdGrid
            ? {
                row: thirdGrid,
                label: 'P3 GRID' as const,
                sub: thirdGrid.Q3 ?? thirdGrid.Q2 ?? thirdGrid.Q1,
              }
            : fq1
              ? { row: fq1, label: 'FASTEST Q1' as const, sub: fq1.Q1 }
              : null;

    const poleColor = getTeamColor(pole?.Constructor.constructorId);
    const secondColor = getTeamColor(second?.Constructor.constructorId);
    const thirdColor = getTeamColor(third?.row?.Constructor.constructorId);

    return (
      <View style={heroStyles.row}>
        <HeroCard
          label="POLE"
          icon="⚡"
          name={pole?.Driver.code}
          team={pole?.Constructor.name}
          sub={pole?.Q3 ?? pole?.Q2 ?? pole?.Q1}
          color={poleColor}
        />
        <HeroCard
          label="P2 GRID"
          icon="🥈"
          name={second?.Driver.code}
          team={second?.Constructor.name}
          sub={second?.Q3 ?? second?.Q2 ?? second?.Q1}
          color={secondColor}
        />
        {third?.row && (
          <HeroCard
            label={third.label}
            icon="⏱"
            name={third.row.Driver.code}
            team={third.row.Constructor.name}
            sub={third.sub}
            color={thirdColor}
          />
        )}
      </View>
    );
  }

  return null;
}

// ── Results tab ────────────────────────────────────────────────────────────────

function PodiumBlock({ result, rank }: { result: ErgastResult; rank: 1 | 2 | 3 }) {
  const heights = { 1: 88, 2: 64, 3: 50 };
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const accentColors = {
    1: '#FFD700',
    2: '#C0C0C0',
    3: '#CD7F32',
  };
  const color = accentColors[rank];
  const teamColor = getTeamColor(result.Constructor.constructorId);

  return (
    <View style={[podStyles.col, rank === 1 && podStyles.colFirst]}>
      <Text style={podStyles.medal}>{medals[rank]}</Text>
      <Text style={[podStyles.code, { color: teamColor }]}>{result.Driver.code}</Text>
      <Text style={podStyles.team} numberOfLines={1}>{result.Constructor.name}</Text>
      {result.points !== '0' && (
        <Text style={podStyles.pts}>{result.points} PTS</Text>
      )}
      <View style={[podStyles.block, {
        height: heights[rank],
        backgroundColor: color + '18',
        borderColor: color + '55',
      }]}>
        <Text style={[podStyles.pos, { color }]}>{rank}</Text>
      </View>
    </View>
  );
}

function GridRow({ result }: { result: ErgastResult }) {
  const pos = parseInt(result.position);
  const isPodium = pos <= 3;
  const isFinished = result.status === 'Finished' || result.status.startsWith('+');
  const teamColor = getTeamColor(result.Constructor.constructorId);
  const hasFastest = result.FastestLap?.rank === '1';

  return (
    <View style={[gridStyles.row, isPodium && gridStyles.rowPodium]}>
      <View style={[gridStyles.stripe, { backgroundColor: teamColor }]} />
      <Text style={[gridStyles.pos, isPodium && { color: Colors.primary }]}>
        {result.position}
      </Text>
      <Text style={gridStyles.grid}>P{result.grid ?? '—'}</Text>
      <View style={gridStyles.driver}>
        <Text style={gridStyles.code}>{result.Driver.code}</Text>
        <Text style={gridStyles.constructor} numberOfLines={1}>
          {result.Constructor.name}
        </Text>
      </View>
      {hasFastest && <Text style={gridStyles.fastestDot}>⚡</Text>}
      <View style={gridStyles.right}>
        <Text style={[gridStyles.time, !isFinished && { color: Colors.primary }]}>
          {result.Time?.time ?? result.status}
        </Text>
        <Text style={gridStyles.pts}>{result.points} PTS</Text>
      </View>
    </View>
  );
}

function ResultsTab({ results }: { results: ErgastResult[] }) {
  const podium = results.slice(0, 3);
  return (
    <View>
      <View style={tabStyles.podium}>
        {podium[1] && <PodiumBlock result={podium[1]} rank={2} />}
        {podium[0] && <PodiumBlock result={podium[0]} rank={1} />}
        {podium[2] && <PodiumBlock result={podium[2]} rank={3} />}
      </View>
      <Text style={tabStyles.sectionLabel}>FULL CLASSIFICATION</Text>
      {results.map(r => <GridRow key={r.position} result={r} />)}
      <View style={{ height: Spacing.xl * 2 }} />
    </View>
  );
}

// ── Qualifying tab ─────────────────────────────────────────────────────────────

function QualifyingTab({ qualifying }: { qualifying: ErgastQualifying[] }) {
  const poleTime = parseQTime(qualifying[0]?.Q3 ?? qualifying[0]?.Q2 ?? qualifying[0]?.Q1);
  const maxDeltaVisible = 3.0; // seconds

  return (
    <View>
      <View style={qualStyles.header}>
        <Text style={qualStyles.colPos}>POS</Text>
        <Text style={qualStyles.colDriver}>DRIVER</Text>
        <Text style={qualStyles.colQ}>Q1</Text>
        <Text style={qualStyles.colQ}>Q2</Text>
        <Text style={qualStyles.colQ}>Q3</Text>
      </View>
      {qualifying.map((q, i) => {
        const teamColor = getTeamColor(q.Constructor.constructorId);
        const bestTime = parseQTime(q.Q3 ?? q.Q2 ?? q.Q1);
        const delta = bestTime && poleTime ? bestTime - poleTime : null;
        const didQ3 = !!q.Q3;
        const didQ2 = !!q.Q2;
        const eliminated = !didQ3
          ? (!didQ2 ? 'Q1' : 'Q2')
          : null;

        return (
          <View key={i} style={[qualStyles.row, i < 3 && qualStyles.rowPodium]}>
            <View style={[qualStyles.stripe, { backgroundColor: teamColor }]} />
            <Text style={[qualStyles.pos, i < 3 && { color: teamColor }]}>
              {q.position}
            </Text>
            <View style={qualStyles.driverCell}>
              <Text style={qualStyles.code}>{q.Driver.code}</Text>
              <Text style={qualStyles.team} numberOfLines={1}>
                {q.Constructor.name}
              </Text>
              {eliminated && (
                <View style={[qualStyles.elim, eliminated === 'Q1' ? qualStyles.elimQ1 : qualStyles.elimQ2]}>
                  <Text style={qualStyles.elimText}>{eliminated} OUT</Text>
                </View>
              )}
            </View>
            <Text style={[qualStyles.qTime, !q.Q1 && qualStyles.qTimeDim]}>{q.Q1 ?? '—'}</Text>
            <Text style={[qualStyles.qTime, !q.Q2 && qualStyles.qTimeDim]}>{q.Q2 ?? '—'}</Text>
            <View style={qualStyles.q3Cell}>
              <Text style={[qualStyles.qTime, qualStyles.q3Time, !q.Q3 && qualStyles.qTimeDim]}>
                {q.Q3 ?? '—'}
              </Text>
              {delta !== null && (
                <View style={[qualStyles.deltaBar, {
                  width: `${Math.min((delta / maxDeltaVisible) * 100, 100)}%`,
                  backgroundColor: teamColor + '60',
                }]} />
              )}
              {delta !== null && (
                <Text style={[qualStyles.deltaText, delta < 0.001 && { color: Colors.primary }]}>
                  {formatDelta(bestTime!, poleTime!)}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      <View style={{ height: Spacing.xl * 2 }} />
    </View>
  );
}

// ── Strategy tab ───────────────────────────────────────────────────────────────

function StrategyTab({ results, pitstops }: {
  results: ErgastResult[];
  pitstops: ErgastPitStop[];
}) {
  if (results.length === 0) {
    return (
      <View style={posStyles.centered}>
        <Text style={posStyles.noDataIcon}>📈</Text>
        <Text style={posStyles.noDataTitle}>No race strategy timeline</Text>
        <Text style={posStyles.noDataSub}>
          Pit-stop stints need a completed Grand Prix (or sprint) in the database. After qualifying
          only, use the QUALIFYING tab — OpenF1 tyre data is on the TYRES tab during the race.
        </Text>
      </View>
    );
  }

  const totalLaps = parseInt(results[0]?.laps ?? '57', 10) || 57;
  const tickInterval = totalLaps > 60 ? 10 : totalLaps > 30 ? 10 : 5;
  const ticks = Array.from(
    { length: Math.floor(totalLaps / tickInterval) },
    (_, i) => (i + 1) * tickInterval
  );

  return (
    <View>
      <Text style={stratStyles.note}>
        Pit-based stint layout from results + stops · compound colours are illustrative
      </Text>
      {results.slice(0, 15).map(result => {
        const driverId = result.Driver.driverId ?? result.Driver.code.toLowerCase();
        const teamColor = getTeamColor(result.Constructor.constructorId);

        const driverPits = pitstops
          .filter(p => p.driverId === driverId)
          .sort((a, b) => parseInt(a.lap) - parseInt(b.lap));

        const stints: { start: number; end: number; n: number }[] = [];
        let start = 1;
        driverPits.forEach((pit, i) => {
          stints.push({ start, end: parseInt(pit.lap) - 1, n: i });
          start = parseInt(pit.lap) + 1;
        });
        stints.push({ start, end: totalLaps, n: driverPits.length });

        return (
          <View key={result.position} style={stratStyles.row}>
            <View style={[stratStyles.stripe, { backgroundColor: teamColor }]} />
            <Text style={[stratStyles.code, { color: teamColor }]}>
              {result.Driver.code}
            </Text>
            <View style={stratStyles.timeline}>
              {stints.map((stint, i) => {
                const lapSpan = Math.max(stint.end - stint.start + 1, 1);
                const flex = lapSpan / totalLaps;
                const color = STINT_COLORS[stint.n % STINT_COLORS.length];
                const isLast = i === stints.length - 1;
                const isFirst = i === 0;
                return (
                  <React.Fragment key={i}>
                    <View style={[stratStyles.stintBar, {
                      flex,
                      backgroundColor: color,
                      borderTopLeftRadius: isFirst ? 4 : 0,
                      borderBottomLeftRadius: isFirst ? 4 : 0,
                      borderTopRightRadius: isLast ? 4 : 0,
                      borderBottomRightRadius: isLast ? 4 : 0,
                    }]}>
                      {lapSpan >= 8 && (
                        <Text style={stratStyles.stintLabel}>{lapSpan}L</Text>
                      )}
                    </View>
                    {!isLast && (
                      <View style={stratStyles.pitMarker}>
                        <Text style={stratStyles.pitLap}>
                          {String(parseInt(driverPits[i]?.lap ?? '0'))}
                        </Text>
                      </View>
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          </View>
        );
      })}

      {/* Lap axis */}
      <View style={stratStyles.axisRow}>
        <View style={stratStyles.codeSpace} />
        <View style={stratStyles.axisLine}>
          <Text style={stratStyles.axisTick}>1</Text>
          {ticks.map(t => (
            <Text
              key={t}
              style={[stratStyles.axisTick, {
                position: 'absolute',
                left: `${((t - 1) / (totalLaps - 1)) * 100}%`,
              }]}
            >
              {t}
            </Text>
          ))}
          <Text style={[stratStyles.axisTick, { position: 'absolute', right: 0 }]}>
            {totalLaps}
          </Text>
        </View>
      </View>

      {/* Compound legend */}
      <View style={stratStyles.legend}>
        {(['SOFT', 'MEDIUM', 'HARD'] as const).map((c, i) => (
          <View key={c} style={stratStyles.legendItem}>
            <View style={[stratStyles.legendDot, { backgroundColor: STINT_COLORS[i] }]} />
            <Text style={stratStyles.legendText}>Stint {i + 1} ({c}*)</Text>
          </View>
        ))}
      </View>
      <View style={{ height: Spacing.xl * 2 }} />
    </View>
  );
}

// ── Positions chart tab ────────────────────────────────────────────────────────

function PositionsTab({ year, round, results, hasRaceResults }: {
  year: string; round: string; results: ErgastResult[];
  hasRaceResults: boolean;
}) {
  const { width: winW } = useWindowDimensions();

  const { data: evo, isLoading } = useQuery({
    queryKey: ['lap_evolution', year, round],
    queryFn: () => history.lapEvolution(year, round),
    enabled: hasRaceResults,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const CHART_H = 220;
  const LABEL_W = 36;
  const PAD_R = 12;
  const PAD_TOP = 8;
  const PAD_BOT = 24;
  const chartW = winW - 32 - LABEL_W - PAD_R; // 32 = outer padding

  const { driverLines, maxLap } = useMemo(() => {
    if (!evo?.laps.length) return { driverLines: [], maxLap: 60 };
    const max = Math.max(...evo.laps.map(l => l.lap));
    const byDriver: Record<string, LapDataPoint[]> = {};
    evo.laps.forEach(l => {
      if (!byDriver[l.driverId]) byDriver[l.driverId] = [];
      byDriver[l.driverId].push(l);
    });
    const lines = Object.entries(byDriver).map(([driverId, pts]) => {
      const result = results.find(r => r.Driver.driverId === driverId);
      const color = getTeamColor(result?.Constructor.constructorId);
      const sorted = [...pts].sort((a, b) => a.lap - b.lap);
      return { driverId, color, points: sorted };
    });
    return { driverLines: lines, maxLap: max };
  }, [evo, results]);

  const lapToX = (lap: number) =>
    ((lap - 1) / Math.max(maxLap - 1, 1)) * chartW;
  const posToY = (pos: number) =>
    PAD_TOP + ((pos - 1) / 19) * (CHART_H - PAD_TOP - PAD_BOT);

  const gridPositions = [1, 5, 10, 15, 20];
  const lapTicks = Array.from({ length: Math.floor(maxLap / 10) }, (_, i) => (i + 1) * 10);

  if (!hasRaceResults) {
    return (
      <View style={posStyles.centered}>
        <Text style={posStyles.noDataIcon}>📊</Text>
        <Text style={posStyles.noDataTitle}>Positions chart needs a finished race</Text>
        <Text style={posStyles.noDataSub}>
          Lap-by-lap position history comes from the Grand Prix timing archive. It is not available
          for qualifying-only weekends in this view.
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={posStyles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={posStyles.loadingText}>Loading position data…</Text>
      </View>
    );
  }

  if (!evo?.laps.length) {
    return (
      <View style={posStyles.centered}>
        <Text style={posStyles.noDataIcon}>📊</Text>
        <Text style={posStyles.noDataTitle}>No lap data available</Text>
        <Text style={posStyles.noDataSub}>
          The backend has no lap evolution for this round yet. Try again after timing is published.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={posStyles.chartTitle}>POSITIONS OVER RACE</Text>
      <View style={posStyles.chartWrap}>
        {/* Y-axis labels */}
        <View style={[posStyles.yAxis, { height: CHART_H }]}>
          {gridPositions.map(p => (
            <Text
              key={p}
              style={[posStyles.yLabel, {
                position: 'absolute',
                top: posToY(p) - 6,
              }]}
            >
              {p}
            </Text>
          ))}
        </View>

        {/* Chart */}
        <Svg width={chartW + PAD_R} height={CHART_H}>
          {/* Grid lines */}
          {gridPositions.map(p => (
            <Line
              key={p}
              x1={0} y1={posToY(p)}
              x2={chartW} y2={posToY(p)}
              stroke={Colors.border}
              strokeWidth={p === 1 ? 1 : 0.5}
              strokeDasharray={p === 1 ? undefined : '3 4'}
            />
          ))}

          {/* Lap tick lines */}
          {lapTicks.map(t => (
            <Line
              key={t}
              x1={lapToX(t)} y1={PAD_TOP}
              x2={lapToX(t)} y2={CHART_H - PAD_BOT}
              stroke={Colors.border}
              strokeWidth={0.5}
              strokeDasharray="2 5"
            />
          ))}

          {/* Driver polylines */}
          {driverLines.map(({ driverId, color, points }) => {
            const pts = points
              .map(p => `${lapToX(p.lap).toFixed(1)},${posToY(p.position).toFixed(1)}`)
              .join(' ');
            return (
              <Polyline
                key={driverId}
                points={pts}
                stroke={color}
                strokeWidth={1.8}
                fill="none"
                opacity={0.8}
              />
            );
          })}

          {/* P1 end-of-race marker */}
          {driverLines.map(({ driverId, color, points }) => {
            const last = points[points.length - 1];
            if (!last || last.position !== 1) return null;
            return (
              <Circle
                key={`end-${driverId}`}
                cx={lapToX(last.lap)}
                cy={posToY(last.position)}
                r={4}
                fill={color}
              />
            );
          })}

          {/* X-axis tick labels */}
          {lapTicks.map(t => (
            <SvgText
              key={`lbl-${t}`}
              x={lapToX(t)}
              y={CHART_H - 6}
              fontSize={9}
              fill={Colors.textMuted}
              textAnchor="middle"
            >
              {t}
            </SvgText>
          ))}
          <SvgText
            x={lapToX(maxLap)}
            y={CHART_H - 6}
            fontSize={9}
            fill={Colors.textMuted}
            textAnchor="end"
          >
            {maxLap}
          </SvgText>
        </Svg>
      </View>

      {/* Driver colour legend */}
      <View style={posStyles.legend}>
        {driverLines.map(({ driverId, color }) => {
          const result = results.find(r => r.Driver.driverId === driverId);
          return (
            <View key={driverId} style={posStyles.legendItem}>
              <View style={[posStyles.legendLine, { backgroundColor: color }]} />
              <Text style={posStyles.legendCode}>{result?.Driver.code ?? driverId.slice(0, 3).toUpperCase()}</Text>
            </View>
          );
        })}
      </View>
      <View style={{ height: Spacing.xl * 2 }} />
    </View>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────────

const TABS: ReportTab[] = ['RESULTS', 'QUALIFYING', 'STRATEGY', 'POSITIONS'];

function TabBar({ active, onChange }: {
  active: ReportTab;
  onChange: (t: ReportTab) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={tabBarStyles.container}
      contentContainerStyle={tabBarStyles.content}
    >
      {TABS.map(t => (
        <TouchableOpacity
          key={t}
          style={tabBarStyles.tab}
          onPress={() => onChange(t)}
          activeOpacity={0.7}
        >
          <Text style={[tabBarStyles.label, active === t && tabBarStyles.labelActive]}>
            {t}
          </Text>
          {active === t && <View style={tabBarStyles.indicator} />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Race header ────────────────────────────────────────────────────────────────

function RaceHeader({
  race,
  badge,
}: {
  race: FullRaceReport['race'];
  badge: 'final' | 'qualifying' | 'schedule';
}) {
  if (!race) return null;
  const dateStr = race.date
    ? new Date(race.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const badgeText =
    badge === 'final'
      ? '🏁 FINAL'
      : badge === 'qualifying'
        ? '⏱ QUALIFYING'
        : '📅 ROUND';
  return (
    <View style={headerStyles.container}>
      <View style={headerStyles.left}>
        <Text style={headerStyles.round}>
          ROUND {race.round ?? '—'} · {race.season ?? ''}
        </Text>
        <Text style={headerStyles.name}>{race.raceName ?? 'Race'}</Text>
        <Text style={headerStyles.circuit}>
          {race.Circuit?.Location?.locality ?? ''}{race.Circuit?.Location?.country ? ` · ${race.Circuit.Location.country}` : ''}
          {dateStr ? `  ·  ${dateStr}` : ''}
        </Text>
      </View>
      <View style={headerStyles.badge}>
        <Text style={headerStyles.badgeText}>{badgeText}</Text>
      </View>
    </View>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function RaceAnalysis({
  year = 'current',
  round = 'last',
  /** Bust React Query cache when the same year/round could mean a different picked session */
  cacheScope,
}: {
  year?: string;
  round?: string;
  cacheScope?: string | number;
}) {
  const [activeTab, setActiveTab] = useState<ReportTab>('RESULTS');

  const scope = cacheScope ?? 'default';
  const reportKey = `${year}:${round}:${String(scope)}`;
  const autoTabKeyRef = useRef<string | null>(null);

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ['race_report', year, round, scope],
    queryFn: () => history.raceReport(year, round),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!report || autoTabKeyRef.current === reportKey) return;
    autoTabKeyRef.current = reportKey;
    if (report.results.length === 0 && report.qualifying.length > 0) {
      setActiveTab('QUALIFYING');
    }
  }, [report, reportKey]);

  if (isLoading) {
    return (
      <View style={mainStyles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={mainStyles.loadingText}>Loading race data…</Text>
      </View>
    );
  }

  if (error || !report) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';
    return (
      <View style={mainStyles.centered}>
        <Text style={mainStyles.errorIcon}>⚠</Text>
        <Text style={mainStyles.errorTitle}>COULD NOT LOAD RACE DATA</Text>
        {detail ? (
          <Text style={mainStyles.errorDetail} numberOfLines={6}>
            {detail}
          </Text>
        ) : null}
        <TouchableOpacity style={mainStyles.retryBtn} onPress={() => refetch()}>
          <Text style={mainStyles.retryText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { race, results, qualifying, pitstops } = report;

  const headerBadge =
    results.length > 0 ? 'final' : qualifying.length > 0 ? 'qualifying' : 'schedule';
  const hasHero = results.length > 0 || qualifying.length > 0;
  const tabBarIndex = hasHero ? 2 : 1;

  return (
    <ScrollView
      style={mainStyles.container}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={[tabBarIndex]}
    >
      <RaceHeader race={race} badge={headerBadge} />
      {hasHero && <HeroCards results={results} qualifying={qualifying} />}
      {results.length === 0 && qualifying.length === 0 && race && (
        <View style={mainStyles.practiceHint}>
          <Text style={mainStyles.practiceHintText}>
            No race or qualifying results in the database for this round yet. During practice
            sessions, use the LIVE tab for real-time gaps and sectors from OpenF1.
          </Text>
        </View>
      )}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'RESULTS' && results.length > 0 && (
        <ResultsTab results={results} />
      )}
      {activeTab === 'QUALIFYING' && qualifying.length > 0 && (
        <QualifyingTab qualifying={qualifying} />
      )}
      {activeTab === 'STRATEGY' && (
        <StrategyTab results={results} pitstops={pitstops} />
      )}
      {activeTab === 'POSITIONS' && (
        <PositionsTab
          year={year}
          round={round}
          results={results}
          hasRaceResults={results.length > 0}
        />
      )}

      {((activeTab === 'RESULTS' && results.length === 0) ||
        (activeTab === 'QUALIFYING' && qualifying.length === 0)) && (
        <View style={mainStyles.centered}>
          <Text style={mainStyles.errorIcon}>🏁</Text>
          <Text style={mainStyles.errorTitle}>NO DATA</Text>
          <Text style={mainStyles.noDataSub}>Data not available for this race.</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const heroStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 2,
    borderTopColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: Colors.textMuted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
  },
  icon: { fontSize: 14 },
  name: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
  },
  team: {
    color: Colors.textSecondary,
    fontSize: 9,
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 9,
    marginTop: 2,
  },
});

const podStyles = StyleSheet.create({
  col: { flex: 1, alignItems: 'center', gap: 4, maxWidth: 120 },
  colFirst: { flex: 1.1 },
  medal: { fontSize: 20 },
  code: { fontSize: FontSize.md, fontWeight: '900', letterSpacing: 1 },
  team: { color: Colors.textMuted, fontSize: 9, textAlign: 'center' },
  pts: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  block: {
    width: '90%',
    borderRadius: Radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  pos: { fontSize: FontSize.xl, fontWeight: '900' },
});

const gridStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingRight: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '40',
    backgroundColor: Colors.surface,
    marginBottom: 1,
  },
  rowPodium: { backgroundColor: Colors.surfaceHigh },
  stripe: { width: 3, height: '100%', marginRight: Spacing.sm },
  pos: {
    width: 28,
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '800',
    textAlign: 'center',
  },
  grid: {
    width: 28,
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  driver: { flex: 1, paddingLeft: 2 },
  code: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '800', letterSpacing: 1 },
  constructor: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },
  fastestDot: { fontSize: 12, marginRight: 4 },
  right: { alignItems: 'flex-end', gap: 2 },
  time: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '700' },
  pts: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
});

const tabStyles = StyleSheet.create({
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
});

const qualStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  colPos: { width: 28, color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  colDriver: { flex: 1, color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  colQ: { width: 64, color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingRight: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '33',
    backgroundColor: Colors.surface,
    marginBottom: 1,
    minHeight: 52,
  },
  rowPodium: { backgroundColor: Colors.surfaceHigh },
  stripe: { width: 3, alignSelf: 'stretch', marginRight: Spacing.sm },
  pos: {
    width: 24,
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '800',
    textAlign: 'center',
  },
  driverCell: { flex: 1, paddingLeft: 4 },
  code: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '800', letterSpacing: 1 },
  team: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },
  elim: {
    marginTop: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.xs,
    alignSelf: 'flex-start',
  },
  elimQ1: { backgroundColor: Colors.primary + '22' },
  elimQ2: { backgroundColor: Colors.safetyCarYellow + '22' },
  elimText: { fontSize: 8, fontWeight: '800', color: Colors.textMuted },
  qTime: {
    width: 64,
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  qTimeDim: { color: Colors.textMuted + '80' },
  q3Cell: {
    width: 80,
    alignItems: 'flex-end',
    paddingRight: 4,
    gap: 2,
  },
  q3Time: { fontSize: 10, fontWeight: '700', textAlign: 'right', color: Colors.text },
  deltaBar: {
    height: 3,
    borderRadius: 1.5,
    alignSelf: 'flex-end',
    minWidth: 2,
    maxWidth: '100%',
  },
  deltaText: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
});

const stratStyles = StyleSheet.create({
  note: {
    color: Colors.textMuted,
    fontSize: 9,
    fontStyle: 'italic',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 4,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '30',
  },
  stripe: { width: 3, height: 20, borderRadius: 1.5, marginRight: 6 },
  code: {
    width: 36,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  timeline: {
    flex: 1,
    flexDirection: 'row',
    height: 20,
    alignItems: 'center',
  },
  stintBar: {
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.9,
  },
  stintLabel: {
    color: '#000',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pitMarker: {
    width: 1,
    height: 22,
    backgroundColor: Colors.background,
    alignItems: 'center',
    zIndex: 1,
  },
  pitLap: {
    position: 'absolute',
    bottom: -12,
    color: Colors.textMuted,
    fontSize: 7,
    fontWeight: '600',
    width: 20,
    textAlign: 'center',
    left: -9.5,
  },
  axisRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: 4,
  },
  codeSpace: { width: 36 + 6 + 3 },
  axisLine: {
    flex: 1,
    height: 16,
    position: 'relative',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  axisTick: {
    color: Colors.textMuted,
    fontSize: 8,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    flexWrap: 'wrap',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 12, height: 12, borderRadius: 2 },
  legendText: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
});

const posStyles = StyleSheet.create({
  centered: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  noDataIcon: { fontSize: 36 },
  noDataTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '800' },
  noDataSub: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center', maxWidth: 260 },
  chartTitle: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  chartWrap: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  yAxis: {
    width: 36,
    position: 'relative',
  },
  yLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'right',
    width: 30,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 16, height: 3, borderRadius: 1.5 },
  legendCode: { color: Colors.textMuted, fontSize: 9, fontWeight: '700' },
});

const tabBarStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  content: {
    paddingHorizontal: Spacing.sm,
    gap: 0,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    alignItems: 'center',
    position: 'relative',
  },
  label: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  labelActive: { color: Colors.text },
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: Spacing.md,
    right: Spacing.md,
    height: 2,
    backgroundColor: Colors.primary,
    borderRadius: 1,
  },
});

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  left: { flex: 1, gap: 3 },
  round: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  name: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '900',
    letterSpacing: 2,
  },
  circuit: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

const mainStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.xs, letterSpacing: 1 },
  errorIcon: { fontSize: 32, color: Colors.primary },
  errorTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '900', letterSpacing: 2 },
  errorDetail: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    lineHeight: 18,
  },
  noDataSub: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center' },
  retryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xl,
  },
  retryText: {
    color: Colors.text,
    fontWeight: '800',
    fontSize: FontSize.xs,
    letterSpacing: 2,
  },
  practiceHint: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  practiceHintText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
});
