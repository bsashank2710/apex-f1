/**
 * F1 race visualization — data model & pure helpers
 * =====================================================
 *
 * ## Architecture (React Native + Expo)
 *
 * | Layer            | Responsibility |
 * |-----------------|----------------|
 * | `f1RaceVisualization.ts` (this file) | Types, leaderboard sort, overtake diff |
 * | `LiveMap.tsx` / `TrackSvg` | 2D SVG circuit + car markers (20 cars @ RAF interpolation) |
 * | `components/map/*` | Leaderboard panel, overtake toast, driver telemetry drawer |
 * | OpenF1 via API    | positions, intervals, laps, car_data, race_control |
 *
 * ## Future upgrades
 * - **Web + WebGL**: add `CircuitMapWebGL.tsx` using `@react-three/fiber` + `expo-gl` for heatmaps / DRS zones.
 * - **Time-series store**: persist `TelemetrySample[]` in SQLite (expo-sqlite) or backend for scrubbable replay.
 * - **Replay**: extend existing Ergast lap replay with `TelemetrySample[]` keyframes when OpenF1 history is available.
 *
 * Performance: SVG is fine for 20 circles + polylines at 60 FPS with `requestAnimationFrame` interpolation.
 */

import { coerceDriverNumber, type Driver, type Interval } from './api';

/** Normalized session bucket for UI mode switches (OpenF1 session names are messy). */
export type VisualizationSessionMode = 'practice' | 'qualifying' | 'sprint' | 'race' | 'unknown';

export function inferSessionMode(sessionName?: string): VisualizationSessionMode {
  const s = (sessionName ?? '').toLowerCase();
  if (s.includes('practice') || s === 'fp1' || s === 'fp2' || s === 'fp3') return 'practice';
  if (s.includes('qualifying') || s.includes('quali')) return 'qualifying';
  if (s.includes('sprint')) return 'sprint';
  if (s.includes('race')) return 'race';
  return 'unknown';
}

/** Single telemetry sample (time-series row) — extend as you ingest more feeds. */
export interface TelemetrySample {
  t: number; // unix ms or session-relative ms
  driver_number: number;
  x?: number;
  y?: number;
  speed_kmh?: number;
  lap_number?: number;
  sector?: 1 | 2 | 3;
  sector_time_ms?: number;
}

export interface CarTrackState {
  driver_number: number;
  /** 1 = race leader */
  race_position: number;
  x: number;
  y: number;
  label: string;
  team_hex: string;
}

/** Sector timing cell highlight (F1 timing tower semantics). */
export type SectorHighlight = 'none' | 'personal_best' | 'overall_fastest';

export interface LeaderboardRow {
  position: number;
  driver_number: number;
  code: string;
  team_name: string;
  team_hex: string;
  gap_to_leader: string;
  interval: string;
  compound?: string;
}

export interface OvertakeEvent {
  passer_dn: number;
  passed_dn: number;
  passer_code: string;
  passed_code: string;
}

function parseGapRank(s?: string): number {
  if (s == null || String(s).trim() === '') return Number.POSITIVE_INFINITY;
  const t = String(s).trim().replace(/^\+/, '');
  const m = t.match(/^(\d+\.?\d*)/);
  if (!m) return Number.POSITIVE_INFINITY;
  return parseFloat(m[1]);
}

/** Running order: leader first (OpenF1 `gap_to_leader` null = P1). */
export function sortDriverNumbersByInterval(intervals: Interval[]): number[] {
  if (!intervals.length) return [];
  const rows = intervals
    .map(i => {
      const dn = coerceDriverNumber(i.driver_number);
      return dn == null ? null : { dn, gap: parseGapRank(i.gap_to_leader) };
    })
    .filter((r): r is { dn: number; gap: number } => r != null);
  rows.sort((a, b) => {
    const aLead = !Number.isFinite(a.gap);
    const bLead = !Number.isFinite(b.gap);
    if (aLead && !bLead) return -1;
    if (!aLead && bLead) return 1;
    return a.gap - b.gap;
  });
  return rows.map(r => r.dn);
}

export function buildLeaderboardRows(intervals: Interval[], drivers: Driver[]): LeaderboardRow[] {
  const dm = new Map<number, Driver>();
  for (const d of drivers) {
    const n = coerceDriverNumber(d.driver_number);
    if (n != null) dm.set(n, d);
  }
  const order = sortDriverNumbersByInterval(intervals);
  return order.map((dn, idx) => {
    const d = dm.get(dn);
    const iv = intervals.find(x => coerceDriverNumber(x.driver_number) === dn);
    const hex = d?.team_colour ? `#${d.team_colour}` : '#E8002D';
    return {
      position: idx + 1,
      driver_number: dn,
      code: d?.name_acronym ?? String(dn),
      team_name: d?.team_name ?? '',
      team_hex: hex,
      gap_to_leader: idx === 0 ? 'LEADER' : (iv?.gap_to_leader ?? '—'),
      interval: idx === 0 ? '—' : (iv?.interval ?? '—'),
      compound: d?.compound,
    };
  });
}

/**
 * Diff two running orders (driver numbers, leader-first).
 * Emits at most a few events per tick to reduce API noise.
 */
export function detectOvertakes(
  prevOrder: number[],
  nextOrder: number[],
  codeLookup: (dn: number) => string,
  maxEvents = 2,
): OvertakeEvent[] {
  if (prevOrder.length < 2 || nextOrder.length < 2) return [];
  const out: OvertakeEvent[] = [];
  for (let ai = 0; ai < nextOrder.length && out.length < maxEvents; ai++) {
    for (let bj = ai + 1; bj < nextOrder.length; bj++) {
      const a = nextOrder[ai];
      const b = nextOrder[bj];
      const prevA = prevOrder.indexOf(a);
      const prevB = prevOrder.indexOf(b);
      if (prevA < 0 || prevB < 0) continue;
      if (prevA > prevB) {
        out.push({
          passer_dn: a,
          passed_dn: b,
          passer_code: codeLookup(a),
          passed_code: codeLookup(b),
        });
      }
    }
  }
  return out;
}

/** Compare sector time to session bests for purple / green styling. */
export function sectorHighlights(args: {
  s1?: number;
  s2?: number;
  s3?: number;
  fastest_s1?: number;
  fastest_s2?: number;
  fastest_s3?: number;
  pb_s1?: number;
  pb_s2?: number;
  pb_s3?: number;
}): [SectorHighlight, SectorHighlight, SectorHighlight] {
  const pick = (v: number | undefined, fastest: number | undefined, pb: number | undefined): SectorHighlight => {
    if (v == null || v <= 0) return 'none';
    if (fastest != null && v === fastest) return 'overall_fastest';
    if (pb != null && v === pb) return 'personal_best';
    return 'none';
  };
  return [
    pick(args.s1, args.fastest_s1, args.pb_s1),
    pick(args.s2, args.fastest_s2, args.pb_s2),
    pick(args.s3, args.fastest_s3, args.pb_s3),
  ];
}
