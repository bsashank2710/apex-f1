/**
 * LiveMap — GPS track map with race replay.
 *
 * LIVE SESSION  → real-time OpenF1 positions polled every 2 s.
 * HISTORICAL    → FastF1 circuit outline + Ergast lap-by-lap positions.
 *                 Supports 1x–5x playback with smooth car animation.
 */

import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated,
  TouchableOpacity, ActivityIndicator, useWindowDimensions, Platform,
  Image,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Text as SvgText, Polyline, Rect } from 'react-native-svg';
import { live, history, telemetry, coerceDriverNumber } from '../lib/api';
import type { Position, Driver, SessionEntry, Interval } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SessionPicker } from '../components/SessionPicker';
import { useRaceStore } from '../store/raceStore';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import {
  FastestSectorsPanel,
  buildDriverLookupForSession,
  computeSectorBests,
  SECTOR_VISUAL_COLORS,
  type SectorId,
} from '../components/FastestSectorsPanel';
import { sortDriverNumbersByInterval } from '../lib/f1RaceVisualization';
import { openF1LocationMatchesErgastRace } from '../lib/openF1ErgastMatch';
import { isHistoricalOnly } from '../lib/config';
import {
  expandQualifyingSessionName,
  isQualifyingSessionName,
  sessionSupportsErgastLapReplay,
} from '../lib/sessionDisplay';
import { QualifyingResultsPanel } from '../components/QualifyingResultsPanel';

// ── Geometry ───────────────────────────────────────────────────────────────────

const PAD   = 40;
const SECTOR_MARKER_COUNT = 12;
const MIN_TRACK_POINTS = 8;

interface Pt { x: number; y: number }

/** API / cache may hand back loose numbers; guard so SVG polylines never get NaN on web. */
function coerceCircuitPoints(raw: unknown[] | undefined): Pt[] {
  if (!Array.isArray(raw)) return [];
  const out: Pt[] = [];
  for (const p of raw) {
    const o = p as { x?: unknown; y?: unknown };
    const x = Number(o?.x);
    const y = Number(o?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x === 0 && y === 0) continue;
    out.push({ x, y });
  }
  return out;
}

function buildNorm(points: Pt[], size: number) {
  const v = points.filter(
    p => (p.x !== 0 || p.y !== 0) && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (v.length < 2) return null;
  const xs = v.map(p => p.x), ys = v.map(p => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sc = Math.min(
    (size - 2 * PAD) / (x1 - x0 || 1),
    (size - 2 * PAD) / (y1 - y0 || 1),
  );
  const ox = (size - (x1 - x0) * sc) / 2;
  const oy = (size - (y1 - y0) * sc) / 2;
  return (p: Pt) => ({ nx: ox + (p.x - x0) * sc, ny: oy + (p.y - y0) * sc });
}

function buildArcs(path: Pt[]): number[] {
  const a = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    a.push(a[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return a;
}

function ptAt(path: Pt[], arcs: number[], frac: number): Pt {
  if (!path.length) return { x: 0, y: 0 };
  const tgt = Math.max(0, Math.min(1, frac)) * arcs[arcs.length - 1];
  for (let i = 1; i < arcs.length; i++) {
    if (arcs[i] >= tgt) {
      const t = (tgt - arcs[i - 1]) / (arcs[i] - arcs[i - 1] || 1);
      return {
        x: path[i - 1].x + t * (path[i].x - path[i - 1].x),
        y: path[i - 1].y + t * (path[i].y - path[i - 1].y),
      };
    }
  }
  return path[path.length - 1];
}

/** Sample lap arc [frac0, frac1] into screen-space polyline points string. */
function sampleTrackPolylineNorm(
  path: Pt[],
  arcs: number[],
  norm: (p: Pt) => { nx: number; ny: number },
  frac0: number,
  frac1: number,
  steps = 42,
): string {
  if (!path.length || !arcs.length) return '';
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = frac0 + (i / steps) * (frac1 - frac0);
    const p = ptAt(path, arcs, Math.max(0, Math.min(1, u)));
    const { nx, ny } = norm(p);
    pts.push(`${nx.toFixed(1)},${ny.toFixed(1)}`);
  }
  return pts.join(' ');
}

// ── Animated dot positions (live mode only) ────────────────────────────────────

interface DotInfo {
  key: string | number;
  nx: number; ny: number;
  color: string;
  label: string;
  /** @deprecated Ergast-only; use `rank` for UI */
  position: number;
  /** 1 = leader — podium styling on map */
  rank?: number;
}

function dedupeDotsByDriverKey(dots: DotInfo[]): DotInfo[] {
  const m = new Map<string, DotInfo>();
  for (const d of dots) {
    m.set(String(d.key), d);
  }
  return [...m.values()];
}

function useSmoothDots(target: DotInfo[], duration = 500): DotInfo[] {
  const uniqTarget = useMemo(() => dedupeDotsByDriverKey(target), [target]);
  const [current, setCurrent] = useState<DotInfo[]>(uniqTarget);
  const animRef    = useRef<number | null>(null);
  const currentRef = useRef<DotInfo[]>(uniqTarget);

  useEffect(() => {
    const from      = dedupeDotsByDriverKey(currentRef.current);
    const startTime = performance.now();

    const step = (now: number) => {
      const rawT = (now - startTime) / duration;
      const t    = Math.min(rawT, 1);
      const e    = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const interp: DotInfo[] = uniqTarget.map(to => {
        const fromDot = from.find(f => String(f.key) === String(to.key));
        if (!fromDot) return to;
        return { ...to, nx: fromDot.nx + (to.nx - fromDot.nx) * e, ny: fromDot.ny + (to.ny - fromDot.ny) * e };
      });

      currentRef.current = interp;
      setCurrent(interp);
      if (rawT < 1) animRef.current = requestAnimationFrame(step);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(step);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [uniqTarget, duration]);

  return dedupeDotsByDriverKey(current);
}

// ── Continuous replay interpolation helpers ────────────────────────────────────

/**
 * Given a car's arc-fraction at lap N and lap N+1, interpolate its position
 * at fractional progress `frac` (0→1) within that lap.
 *
 * Cars advance one full circuit per lap (arc += 1.0) + any position-change delta.
 * The result wraps modulo 1.0 so it stays on the track loop.
 */
function interpArcFrac(fromFrac: number, toFrac: number, frac: number): number {
  const raw = fromFrac + frac * (1.0 + toFrac - fromFrac);
  return ((raw % 1.0) + 1.0) % 1.0;
}

/** OpenF1 may use camelCase; Android blocks cleartext http images. */
function headshotUri(d: Driver): string | undefined {
  const raw =
    d.headshot_url
    ?? (d as { headshotUrl?: string }).headshotUrl;
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (t.startsWith('http://')) return `https://${t.slice(7)}`;
  return t;
}

/** Map 1–12 distance markers → F1 sectors (≈ thirds of the lap). */
function markerSectorFromIndex(markerNum: number): SectorId {
  if (markerNum <= 4) return 1;
  if (markerNum <= 8) return 2;
  return 3;
}

// ── SVG track — broadcast-style width (scales with viewport), not a hairline ─

function TrackSvg({
  path,
  dots,
  size,
  selectedSector = null,
  onSelectSector,
  interactiveSectors = false,
}: {
  path: Pt[];
  dots: DotInfo[];
  size: number;
  selectedSector?: SectorId | null;
  onSelectSector?: (s: SectorId | null) => void;
  interactiveSectors?: boolean;
}) {
  const norm = useMemo(() => buildNorm(path, size), [path, size]);
  const arcs = useMemo(() => buildArcs(path), [path]);
  /** Stroke scale so large maps stay chunky; small phones still readable. */
  const sc = Math.max(0.92, Math.min(1.55, size / 340));

  const polyStr = useMemo(() => {
    if (!norm || !path.length) return '';
    return path.map(p => {
      const { nx, ny } = norm(p);
      return `${nx.toFixed(1)},${ny.toFixed(1)}`;
    }).join(' ');
  }, [path, norm]);

  const sectorMarkers = useMemo(() => {
    if (!norm || path.length < 2 || !arcs.length) return [];
    const out: { nx: number; ny: number; n: string }[] = [];
    for (let i = 1; i <= SECTOR_MARKER_COUNT; i++) {
      const frac = i / (SECTOR_MARKER_COUNT + 1);
      const pt   = ptAt(path, arcs, frac);
      const { nx, ny } = norm(pt);
      out.push({ nx, ny, n: String(i) });
    }
    return out;
  }, [path, arcs, norm]);

  const baseR   = Math.max(6.5, Math.min(11, size / 48));
  const LABEL_H = Math.round(12 + 4 * sc);
  const LABEL_RX = 5;
  const vb = `0 0 ${size} ${size}`;
  const fsLbl = Math.round(9 + 2 * sc);
  const fsSec = Math.round(8 + sc);
  /** RN-web: SVG as inline replaced content needs `display: block` or it can paint with ~0 height. */
  const svgWebStyle: import('react-native').StyleProp<import('react-native').ViewStyle> | undefined =
    Platform.OS === 'web'
      ? ({ width: size, height: size, flexShrink: 0, display: 'block' } as never)
      : undefined;

  return (
    <View style={[mapS.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={vb} style={svgWebStyle}>
        {polyStr && <>
    <Polyline
            points={polyStr}
            stroke="#9333ea"
            strokeWidth={40 * sc}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
            opacity={0.22}
          />
          <Polyline
            points={polyStr}
            stroke="#00f5ff"
            strokeWidth={32 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.12}
          />
          <Polyline
            points={polyStr}
            stroke="#06060c"
            strokeWidth={26 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points={polyStr}
            stroke="#1c1c2a"
            strokeWidth={18 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points={polyStr}
            stroke="#35354a"
            strokeWidth={11 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Polyline
            points={polyStr}
            stroke="#e8e8f4"
            strokeWidth={5 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.95}
          />
          <Polyline
            points={polyStr}
            stroke={Colors.primary}
            strokeWidth={3.5 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.88}
          />
          <Polyline
            points={polyStr}
            stroke="#ffffff"
            strokeWidth={1.6 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
          />
          <Polyline
            points={polyStr}
            stroke="#facc15"
            strokeWidth={2.2 * sc}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={`${8 * sc} ${10 * sc}`}
            opacity={0.35}
          />
        </>}

        {polyStr && norm && [1, 2, 3].map((sid) => {
          if (selectedSector !== sid) return null;
          const c = SECTOR_VISUAL_COLORS[sid as SectorId];
          const seg = sampleTrackPolylineNorm(path, arcs, norm, (sid - 1) / 3, sid / 3, 52);
          if (!seg) return null;
          return (
            <React.Fragment key={`sec-glow-${sid}`}>
              <Polyline
                points={seg}
                stroke={c}
                strokeWidth={10 * sc}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.22}
              />
              <Polyline
                points={seg}
                stroke={c}
                strokeWidth={3.8 * sc}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
              />
            </React.Fragment>
          );
        })}

        {interactiveSectors && polyStr && norm && onSelectSector && ([1, 2, 3] as const).map((sid) => {
          const hitPts = sampleTrackPolylineNorm(path, arcs, norm, (sid - 1) / 3, sid / 3, 28);
          const toggle = () => onSelectSector(selectedSector === sid ? null : sid);
          return (
            <Polyline
              key={`sec-hit-${sid}`}
              points={hitPts}
              stroke="rgba(0,0,0,0)"
              strokeWidth={52 * sc}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              // RN-web + react-native-svg: onPress enables PanResponder props on the DOM <path>,
              // which React 19 rejects (“Unknown event handler property”). Use onClick only and set
              // onPress: null so prepare() does not overwrite onClick (it uses `onPress !== null`).
              {...(Platform.OS === 'web'
                ? ({ onClick: toggle, onPress: null } as Record<string, unknown>)
                : { onPress: toggle })}
            />
          );
        })}

        {sectorMarkers.map(m => (
          <SvgText
            key={`s-${m.n}`}
            x={m.nx}
            y={m.ny + 4 * sc}
            fontSize={fsSec}
            fill={
              selectedSector != null && selectedSector === markerSectorFromIndex(Number(m.n))
                ? SECTOR_VISUAL_COLORS[markerSectorFromIndex(Number(m.n))]
                : '#8b8ba8'
            }
            textAnchor="middle"
            fontWeight="700"
            opacity={0.9}
          >{m.n}</SvgText>
        ))}

        {dots.map((d, di) => {
          const labelW = Math.max(28, Math.min(52, d.label.length * fsLbl * 0.55 + 14));
          const rk     = d.rank ?? 99;
          const podium = rk === 1 ? '#ffd700' : rk === 2 ? '#e8e8e8' : rk === 3 ? '#cd7f32' : null;
          const rDot   = rk <= 3 ? baseR + 1.5 * sc : baseR;
          return (
            <React.Fragment key={`dot-${String(d.key)}-${di}`}>
              {podium && (
                <Circle
                  cx={d.nx}
                  cy={d.ny}
                  r={rDot + 7}
                  stroke={podium}
                  strokeWidth={2}
                  fill="none"
                  opacity={0.85}
                />
              )}
              <Circle cx={d.nx} cy={d.ny} r={rDot + 3} fill="#000" opacity={0.25} />
              <Circle cx={d.nx} cy={d.ny} r={rDot + 1} fill={d.color} opacity={0.35} />
              <Circle cx={d.nx} cy={d.ny} r={rDot} fill={d.color} />
              <Circle cx={d.nx} cy={d.ny} r={Math.max(2, rDot - 3)} fill="#fff" opacity={0.45} />
              <Rect
                x={d.nx - labelW / 2}
                y={d.ny - rDot - LABEL_H - 4}
                width={labelW}
                height={LABEL_H}
                rx={LABEL_RX}
                ry={LABEL_RX}
                fill="#0e0e14"
                stroke={podium ?? Colors.primary + '66'}
                strokeWidth={podium ? 1.5 : 1}
              />
              <SvgText
                x={d.nx}
                y={d.ny - rDot - 4 - LABEL_H / 2 + 4}
                fontSize={fsLbl}
                fill="#F5F5FF"
                textAnchor="middle"
                fontWeight="800"
                letterSpacing={0.8}
              >{d.label}</SvgText>
            </React.Fragment>
          );
        })}

        {!polyStr && (
          <SvgText x={size / 2} y={size / 2} fontSize={12}
            fill={Colors.textMuted} textAnchor="middle">No track data</SvgText>
        )}
      </Svg>
    </View>
  );
}

// ── Live map ───────────────────────────────────────────────────────────────────

function LiveMapView({
  positions,
  drivers,
  trackPath,
  size,
  intervals,
  selectedSector,
  onSelectSector,
}: {
  positions: Position[];
  drivers: Driver[];
  trackPath: Pt[];
  size: number;
  intervals?: Interval[];
  selectedSector?: SectorId | null;
  onSelectSector?: (s: SectorId | null) => void;
}) {
  const driverMap = useMemo(() => {
    const m = new Map<number, Driver>();
    for (const d of drivers) {
      const n = coerceDriverNumber(d.driver_number);
      if (n != null) m.set(n, d);
    }
    return m;
  }, [drivers]);
  const valid = positions.filter(p => {
    const n = coerceDriverNumber(p.driver_number);
    const x = Number(p.x);
    const y = Number(p.y);
    const ok = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);
    return n != null && ok;
  });

  const rawDots: DotInfo[] = useMemo(() => {
    const order    = sortDriverNumbersByInterval(intervals ?? []);
    const rankByDn = new Map(order.map((dn, i) => [dn, i + 1]));

    const useGpsDots = valid.length >= 1;
    const normGps = buildNorm([
      ...trackPath,
      ...valid.map(p => ({ x: p.x ?? 0, y: p.y ?? 0 })),
    ], size);
    if (useGpsDots && normGps) {
      return valid.map(p => {
        const dn    = coerceDriverNumber(p.driver_number);
        if (dn == null) return null;
        const d     = driverMap.get(dn);
        const color = d?.team_colour ? `#${d.team_colour}` : Colors.primary;
        const { nx, ny } = normGps({ x: p.x ?? 0, y: p.y ?? 0 });
        return {
          key: dn, nx, ny, color,
          label: d?.name_acronym ?? String(dn),
          position: 0,
          rank: rankByDn.get(dn),
        };
      }).filter(Boolean) as DotInfo[];
    }
    // Fallback: running order from intervals (OpenF1 often returns 0–1 rows after session end)
    if (trackPath.length >= MIN_TRACK_POINTS && intervals && intervals.length >= 1 && drivers.length >= 1) {
      const orderDn = sortDriverNumbersByInterval(intervals);
      const norm  = buildNorm(trackPath, size);
      const arcs  = buildArcs(trackPath);
      if (!norm || !arcs.length) return [];
      const n       = Math.min(orderDn.length, drivers.length, 22);
      if (n >= 1) {
        const spread  = 0.72;
        const gapFrac = n > 1 ? spread / (n - 1) : 0;
        const dots: DotInfo[] = [];
        for (let idx = 0; idx < n; idx++) {
          const dn = orderDn[idx];
          const d  = driverMap.get(dn);
          if (!d) continue;
          const frac   = Math.max(0.05, 0.98 - idx * gapFrac);
          const pt     = ptAt(trackPath, arcs, frac);
          const { nx, ny } = norm(pt);
          const color  = d.team_colour ? `#${d.team_colour}` : Colors.primary;
          dots.push({
            key: dn, nx, ny, color,
            label: d.name_acronym ?? String(dn),
            position: 0,
            rank: idx + 1,
          });
        }
        if (dots.length) return dots;
      }
    }
    // Last resort: all drivers evenly on lap (no GPS + no usable intervals — common for ended FP)
    if (trackPath.length >= MIN_TRACK_POINTS && drivers.length >= 1) {
      const norm  = buildNorm(trackPath, size);
      const arcs  = buildArcs(trackPath);
      if (!norm || !arcs.length) return [];
      const ordered = [...drivers].sort((a, b) => {
        const an = coerceDriverNumber(a.driver_number) ?? 0;
        const bn = coerceDriverNumber(b.driver_number) ?? 0;
        return an - bn;
      });
      const n       = Math.min(ordered.length, 22);
      const spread  = 0.72;
      const gapFrac = n > 1 ? spread / (n - 1) : 0;
      const dots: DotInfo[] = [];
      for (let idx = 0; idx < n; idx++) {
        const d      = ordered[idx];
        const frac   = Math.max(0.05, 0.98 - idx * gapFrac);
        const pt     = ptAt(trackPath, arcs, frac);
        const { nx, ny } = norm(pt);
        const color  = d.team_colour ? `#${d.team_colour}` : Colors.primary;
        const dn = coerceDriverNumber(d.driver_number);
        dots.push({
          key: d.driver_number, nx, ny, color,
          label: d.name_acronym ?? String(d.driver_number),
          position: 0,
          rank: dn != null ? rankByDn.get(dn) : undefined,
        });
      }
      return dots;
    }
    return [];
  }, [valid, trackPath, size, intervals, drivers, driverMap]);

  const dots = useSmoothDots(rawDots);
  return (
    <TrackSvg
      path={trackPath}
      dots={dots}
      size={size}
      selectedSector={selectedSector ?? null}
      onSelectSector={onSelectSector}
      interactiveSectors={!!onSelectSector}
    />
  );
}

// ReplayMap removed — continuous interpolation is handled directly in MapContent

// ── Live badge ─────────────────────────────────────────────────────────────────

function LiveBadge() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.15, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={badge.live}>
      <Animated.View style={[badge.dot, { opacity: pulse }]} />
      <Text style={badge.liveText}>LIVE</Text>
    </View>
  );
}

function RecentSessionBadge() {
  return (
    <View style={badge.recent}>
      <Text style={badge.recentText}>TELEMETRY</Text>
    </View>
  );
}

// ── Playback controls ─────────────────────────────────────────────────────────

/**
 * Wall-clock ms simulated per race lap at 1×. Higher = slower, easier to follow on the map.
 * (Real laps are ~70–100 s; we stretch so cars read as cars, not “ants”.)
 * 5× divides this — e.g. 50 s/lap at 1× → ~10 s/lap at 5×.
 */
const BASE_MS_PER_LAP = 50_000;
const SPEEDS = [1, 2, 3, 5];

function PlaybackBar({
  currentTime, total, isPlaying, speed, onPlay, onSpeed, onSeek, maxOuterWidth,
}: {
  currentTime: number; total: number;
  isPlaying: boolean; speed: number;
  onPlay: () => void; onSpeed: (s: number) => void; onSeek: (n: number) => void;
  /** Match track map width on large screens */
  maxOuterWidth?: number;
}) {
  const displayLap = Math.min(total, Math.max(1, Math.ceil(currentTime)));
    return (
    <View style={[pb.container, maxOuterWidth != null && { maxWidth: maxOuterWidth }]}>
      {/* Top row: play + lap counter + speed */}
      <View style={pb.topRow}>
        <TouchableOpacity style={pb.playBtn} onPress={onPlay}>
          <Text style={pb.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
        </TouchableOpacity>

        <View style={pb.lapGroup}>
          <Text style={pb.lapWord}>LAP</Text>
          <Text style={pb.lapNum}>{displayLap}</Text>
          <Text style={pb.lapTotal}> / {total || '—'}</Text>
        </View>

        <View style={pb.arrowGroup}>
          <TouchableOpacity style={pb.arrowBtn} onPress={() => onSeek(Math.max(1, displayLap - 1))}>
            <Text style={pb.arrowTxt}>◀</Text>
          </TouchableOpacity>
          <TouchableOpacity style={pb.arrowBtn} onPress={() => onSeek(Math.min(total || displayLap, displayLap + 1))}>
            <Text style={pb.arrowTxt}>▶</Text>
          </TouchableOpacity>
        </View>

        <View style={pb.speedGroup}>
          {SPEEDS.map(s => (
            <TouchableOpacity key={s}
              style={[pb.speedBtn, s === speed && pb.speedBtnActive]}
              onPress={() => onSpeed(s)}>
              <Text style={[pb.speedTxt, s === speed && pb.speedTxtActive]}>{s}×</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Scrubber ticks */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pb.ticks}>
        {[1, ...Array.from({ length: Math.floor((total - 1) / 5) }, (_, i) => (i + 1) * 5), total]
          .filter((v, i, a) => a.indexOf(v) === i && v >= 1 && v <= total)
          .map(t => (
            <TouchableOpacity key={t} onPress={() => onSeek(t)}
              style={[pb.tick, t === displayLap && pb.tickActive]}>
              <Text style={[pb.tickLbl, t === displayLap && pb.tickLblActive]}>
                {t === 1 ? 'S' : t === total ? 'E' : String(t)}
              </Text>
            </TouchableOpacity>
          ))}
      </ScrollView>
      </View>
    );
  }

// ── Weather card ───────────────────────────────────────────────────────────────

function WeatherInsights({ sessionKey }: { sessionKey: string | number }) {
  const isLive = sessionKey === 'latest';
  const { data: arr } = useQuery({
    queryKey: ['weather_map', sessionKey],
    queryFn: () => live.weather(sessionKey),
    refetchInterval: isLive ? 30000 : false,
    staleTime: 20000,
  });
  const w = arr?.[arr.length - 1];
  if (!w) return null;
  const isWet  = (w.rainfall ?? 0) > 0;
  const trackT = w.track_temperature ?? 0;
  const heatColor = trackT > 45 ? Colors.soft : trackT > 30 ? Colors.safetyCarYellow : Colors.wet;

  return (
    <View style={[wxS.card, isWet && wxS.cardWet]}>
      <Text style={wxS.heading}>WEATHER</Text>
      <View style={wxS.row}>
        {[
          { label: 'AIR',      value: `${w.air_temperature?.toFixed(1) ?? '—'}°C`, color: Colors.text },
          { label: 'TRACK',    value: `${trackT.toFixed(1)}°C`,                    color: heatColor },
          { label: 'WIND',     value: `${w.wind_speed?.toFixed(0) ?? '—'} km/h`,   color: Colors.text },
          { label: 'HUMIDITY', value: `${w.humidity?.toFixed(0) ?? '—'}%`,          color: Colors.text },
        ].map((item, i) => (
          <React.Fragment key={item.label}>
            {i > 0 && <View style={wxS.divider} />}
            <View style={wxS.item}>
              <Text style={wxS.label}>{item.label}</Text>
              <Text style={[wxS.value, { color: item.color }]}>{item.value}</Text>
            </View>
          </React.Fragment>
        ))}
        {isWet && <>
          <View style={wxS.divider} />
          <View style={wxS.item}>
            <Text style={wxS.rainText}>🌧 RAIN</Text>
            <Text style={wxS.rainSub}>{w.rainfall?.toFixed(1)} mm</Text>
          </View>
        </>}
      </View>
    </View>
  );
}

// ── Driver legend ──────────────────────────────────────────────────────────────

type LegendItem = { code: string; color: string; headshot_url?: string | null };

function DriverLegend({ items }: { items: LegendItem[] }) {
  if (!items.length) return null;
  return (
    <View style={legS.wrap}>
      {items.map(d => (
        <View key={d.code} style={legS.item}>
          {d.headshot_url ? (
            <Image
              source={{ uri: d.headshot_url }}
              style={legS.face}
              resizeMode="cover"
              accessibilityLabel={d.code}
            />
          ) : (
            <View style={[legS.dot, { backgroundColor: d.color }]} />
          )}
          <Text style={legS.code}>{d.code}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Loading / Error states ─────────────────────────────────────────────────────

function CircuitLoading({ raceName }: { raceName?: string }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={loadS.box}>
      <Animated.Text style={[loadS.icon, { opacity: pulse }]}>🏎</Animated.Text>
      <Text style={loadS.title}>LOADING CIRCUIT DATA</Text>
      {raceName && <Text style={loadS.subtitle}>{raceName}</Text>}
      <Text style={loadS.note}>
        First load pulls track geometry (often 15–45 s). After that it is cached on the server and loads instantly.
      </Text>
    </View>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

/** Ergast schedule needs a season year; OpenF1 often omits `year` on sessions. */
function seasonYearFromSession(info: SessionEntry | null | undefined): string | undefined {
  if (!info) return undefined;
  if (info.year != null && !Number.isNaN(Number(info.year))) return String(info.year);
  const ds = info.date_start;
  if (ds) {
    const y = new Date(ds).getUTCFullYear();
    if (!Number.isNaN(y) && y >= 1950) return String(y);
  }
  return undefined;
}

function MapContent() {
  const queryClient = useQueryClient();
  const { width, height } = useWindowDimensions();
  /** Square map: prioritize size — up to ~88% of viewport height minus chrome. */
  const mapSize = useMemo(() => {
    const pad = 12;
    const usableW = Math.max(0, width - pad * 2);
    const maxByH  = Math.max(300, Math.min(height * 0.88, height - 88));
    const side    = Math.floor(Math.min(usableW, maxByH));
    return Math.max(300, Math.min(side, 1700));
  }, [width, height]);

  const {
    selectedSessionKey,
    mapFocus,
    liveSession,
    effectiveKey,
    mapSessionFetched,
  } = useOpenF1LiveContext();
  const selectedSessionInfo = useRaceStore(s => s.selectedSessionInfo);

  // Full OpenF1 row for the selected key (store copy can omit circuit/location). Same source as SessionPicker pill.
  const { data: sessionDetail } = useQuery({
    queryKey: ['session_info', selectedSessionKey],
    queryFn: () =>
      live
        .sessions(undefined, undefined, undefined, Number(selectedSessionKey))
        .then((rows) => rows[0] ?? null),
    enabled: typeof selectedSessionKey === 'number',
    staleTime: 5 * 60 * 1000,
  });

  const resolvedPickedSession = useMemo((): SessionEntry | null => {
    if (selectedSessionKey === 'pending') return null;
    if (selectedSessionKey === 'latest') return null;
    const api = sessionDetail;
    const fromStore = selectedSessionInfo;
    if (!api && !fromStore) return null;
    const yearNum =
      fromStore?.year
      ?? (api as SessionEntry | undefined)?.year
      ?? (() => {
        const ys = seasonYearFromSession((api ?? fromStore) as SessionEntry);
        if (ys == null) return undefined;
        const n = parseInt(ys, 10);
        return Number.isFinite(n) ? n : undefined;
      })();
    return {
      ...(fromStore ?? {}),
      ...(api ?? {}),
      session_key: selectedSessionKey as number,
      year: yearNum,
    } as SessionEntry;
  }, [selectedSessionKey, sessionDetail, selectedSessionInfo]);

  /**
   * Use OpenF1 + /track_path for the map whenever we know which session to bind to.
   * Do not require map_phase live/recent — “upcoming” or gaps still have a meeting + circuit;
   * the old gate sent users to Ergast+FastF1 replay (slow, wrong GP if Ergast match failed).
   */
  /** After map_session settles, bind OpenF1 track_path using map focus, /session, or backend "latest". */
  const latestOpenF1Key =
    mapFocus?.session_key ?? liveSession?.session_key ?? null;
  const trackMapActive =
    typeof selectedSessionKey === 'number'
    || (
      selectedSessionKey === 'latest'
      && (latestOpenF1Key != null || mapSessionFetched)
    );

  // Ergast matching: explicit picker session OR current weekend from map focus (fixes “latest” showing wrong GP)
  const ergastMatchSource = useMemo((): SessionEntry | null => {
    if (resolvedPickedSession) return resolvedPickedSession;
    if (selectedSessionKey === 'latest' && mapFocus && (mapFocus.circuit_short_name || mapFocus.location)) {
      return {
        session_key: mapFocus.session_key,
        session_name: mapFocus.session_name ?? '',
        meeting_key: mapFocus.meeting_key ?? 0,
        location: mapFocus.location,
        country_name: mapFocus.country_name,
        circuit_short_name: mapFocus.circuit_short_name,
        year: mapFocus.year,
        date_start: mapFocus.date_start,
      } as SessionEntry;
    }
    return null;
  }, [resolvedPickedSession, selectedSessionKey, mapFocus]);

  // ── Resolve year + round from selected session ─────────────────────────────
  const pickedYear =
    seasonYearFromSession(ergastMatchSource ?? selectedSessionInfo)
    ?? (selectedSessionKey === 'latest' && mapFocus?.year != null ? String(mapFocus.year) : undefined);

  const { data: pickedSchedule } = useQuery({
    queryKey: ['schedule', pickedYear],
    queryFn: () => history.schedule(pickedYear!),
    enabled: !!pickedYear,
    staleTime: 60 * 60 * 1000,
  });

  const pickedRace = useMemo(() => {
    if (!pickedSchedule || !ergastMatchSource) return null;
    const s = ergastMatchSource;
    const byLoc = pickedSchedule.filter(r =>
      openF1LocationMatchesErgastRace(s.location, s.country_name, r)
    );
    const byCircuit = pickedSchedule.filter(r => {
      const cs = (s.circuit_short_name ?? '').trim().toLowerCase();
      if (!cs) return false;
      const first = (r.Circuit?.circuitName ?? '').toLowerCase().split(/\s+/)[0] ?? '';
      return first.length >= 2 && cs.includes(first);
    });
    const poolRaw = byLoc.length > 0 ? byLoc : byCircuit;
    const pool = poolRaw.length > 0 ? poolRaw : [];
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];
    const t0 = s.date_start ? Date.parse(s.date_start) : NaN;
    if (!Number.isFinite(t0)) return pool[0];
    let best = pool[0];
    let bestDelta = Infinity;
    for (const r of pool) {
      const t1 = r.date ? Date.parse(r.date) : NaN;
      if (!Number.isFinite(t1)) continue;
      const d = Math.abs(t0 - t1);
      if (d < bestDelta) {
        bestDelta = d;
        best = r;
      }
    }
    return best;
  }, [pickedSchedule, ergastMatchSource]);

  // Only when browsing “latest” — never blend “last race” with an explicit session pick (wrong year / Monaco, etc.)
  const { data: lastRaceReport } = useQuery({
    queryKey: ['race_report', 'current', 'last'],
    queryFn: () => history.raceReport('current', 'last'),
    enabled: selectedSessionKey === 'latest',
    staleTime: 10 * 60 * 1000,
  });

  // Resolved identifiers — explicit session: Ergast match only (no lastRace bleed-through)
  const year     = pickedRace?.season   ?? (selectedSessionKey === 'latest' ? lastRaceReport?.race?.season : undefined);
  const round    = pickedRace?.round    ?? (selectedSessionKey === 'latest' ? lastRaceReport?.race?.round : undefined);
  const raceName = pickedRace?.raceName ?? (selectedSessionKey === 'latest' ? lastRaceReport?.race?.raceName : undefined);
  const sessionType =
    resolvedPickedSession?.session_name
    ?? (selectedSessionKey === 'latest' ? mapFocus?.session_name : undefined)
    ?? selectedSessionInfo?.session_name;

  const isQualiUi = isQualifyingSessionName(sessionType);
  const sprintQuali = (sessionType ?? '').trim() === 'Sprint Qualifying';

  /** Shown while FastF1 loads — never prefer Ergast “last” over OpenF1 map focus / picker. */
  const circuitLoadingLabel = useMemo(() => {
    if (selectedSessionKey === 'pending') return 'Loading session…';
    if (selectedSessionKey !== 'latest') {
      if (pickedRace?.raceName) return pickedRace.raceName;
      const s = resolvedPickedSession;
      if (s) {
        const place = [s.circuit_short_name, s.location].find(Boolean);
        const line  = [place, s.country_name].filter(Boolean).join(' · ');
        if (line) {
          const sn = expandQualifyingSessionName(s.session_name);
          return sn ? `${line} · ${sn}` : line;
        }
      }
      return 'Selected session…';
    }
    const fromFocus = mapFocus?.circuit_short_name
      ? [
          mapFocus.circuit_short_name,
          mapFocus.country_name,
          expandQualifyingSessionName(mapFocus.session_name),
        ].filter(Boolean).join(' · ')
      : '';
            return (
      fromFocus
      || pickedRace?.raceName
      || (liveSession?.circuit_short_name
        ? [
            liveSession.circuit_short_name,
            liveSession.country_name,
            expandQualifyingSessionName(liveSession.session_name),
          ].filter(Boolean).join(' · ')
        : '')
      || lastRaceReport?.race?.raceName
      || '…'
    );
  }, [selectedSessionKey, pickedRace, resolvedPickedSession, lastRaceReport, mapFocus, liveSession]);

  // ── Live GPS (+ intervals fallback for practice when GPS not published) ───
  const {
    data: trackData,
    isPending: trackPathPending,
    isError: trackPathError,
    isFetching: trackPathFetching,
    refetch: refetchTrack,
  } = useQuery({
    queryKey: ['track_path', effectiveKey],
    queryFn: () => live.trackPath(effectiveKey!),
    enabled: trackMapActive && effectiveKey != null,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  /** OpenF1 sometimes returns an empty path on refetch; never swap a good outline for blank. */
  const lastGoodTrackRef = useRef<Pt[]>([]);
  const trackSessionKeyRef = useRef<string | number | null>(null);

  const displayTrackPath = useMemo(() => {
    if (effectiveKey != null && trackSessionKeyRef.current !== effectiveKey) {
      trackSessionKeyRef.current = effectiveKey;
      lastGoodTrackRef.current = [];
    }
    const raw = trackData?.path;
    if (raw && raw.length >= MIN_TRACK_POINTS) {
      lastGoodTrackRef.current = raw;
      return raw;
    }
    return lastGoodTrackRef.current;
  }, [trackData, effectiveKey]);

  const hasStableOutline = displayTrackPath.length >= MIN_TRACK_POINTS;
  const trackPathFetchFailed = !trackPathPending && trackPathError && !hasStableOutline;

  useEffect(() => {
    if (!trackMapActive || effectiveKey == null) return;
    const k = effectiveKey;
    const prefetch = () => {
      void queryClient.prefetchQuery({
        queryKey: ['track_path', k],
        queryFn: () => live.trackPath(k),
        staleTime: 10 * 60 * 1000,
      });
      void queryClient.prefetchQuery({
        queryKey: ['drivers', k],
        queryFn: () => live.drivers(k),
        staleTime: 60_000,
      });
      void queryClient.prefetchQuery({
        queryKey: ['gps_position', k],
        queryFn: () => live.position(k),
        staleTime: 2000,
      });
    };
    prefetch();
  }, [trackMapActive, effectiveKey, queryClient]);

  const { data: liveDrivers }   = useQuery({
    queryKey: ['drivers', effectiveKey],
    queryFn: () => live.drivers(effectiveKey!),
    enabled: trackMapActive && effectiveKey != null,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const { data: rawPositions }  = useQuery({
    queryKey: ['gps_position', effectiveKey],
    queryFn: () => live.position(effectiveKey!),
    enabled: trackMapActive && effectiveKey != null,
    staleTime: mapFocus?.map_phase === 'live' ? 1500 : 5000,
    refetchInterval: mapFocus?.map_phase === 'live' ? 2500 : 10_000,
    retry: 1,
  });
  const { data: liveIntervals } = useQuery({
    queryKey: ['intervals', effectiveKey],
    queryFn: () => live.intervals(effectiveKey!),
    enabled: trackMapActive && effectiveKey != null,
    staleTime: 2000,
    refetchInterval: mapFocus?.map_phase === 'live' ? 5000 : 12_000,
  });

  const livePositions = useMemo(() => {
    if (!rawPositions) return [];
    const m = new Map<number, Position>();
    rawPositions.forEach(p => {
      const dn = coerceDriverNumber(p.driver_number);
      if (dn == null) return;
      const cur = m.get(dn);
      if (!cur || (p.date ?? '') > (cur.date ?? '')) m.set(dn, { ...p, driver_number: dn });
    });
    return Array.from(m.values());
  }, [rawPositions]);

  const pollOpenF1Live = selectedSessionKey === 'latest' && !isHistoricalOnly();

  const { data: sessionLapsForSectors, isLoading: lapsSectorsLoading } = useQuery({
    queryKey: ['live_laps_sectors', effectiveKey],
    queryFn: () => live.laps(effectiveKey!),
    enabled: trackMapActive && effectiveKey != null,
    refetchInterval: trackMapActive
      ? (pollOpenF1Live
        ? (mapFocus?.map_phase === 'live' ? 12_000 : 20_000)
        : 15_000)
      : false,
    staleTime: pollOpenF1Live ? 8000 : 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const sectorDriverLookup = useMemo(
    () => buildDriverLookupForSession(sessionLapsForSectors, liveDrivers ?? []),
    [sessionLapsForSectors, liveDrivers],
  );

  const sectorBestRows = useMemo(
    () => computeSectorBests(sessionLapsForSectors, sectorDriverLookup),
    [sessionLapsForSectors, sectorDriverLookup],
  );

  /** Don’t start Ergast/FastF1 replay until map_session has completed at least once (avoids isPending stuck on disabled / hung fetch). */
  const awaitingMapSession =
    selectedSessionKey === 'latest' && !mapSessionFetched && !isHistoricalOnly();
  const useHistoricalReplay =
    !trackMapActive && !!year && !!round && !awaitingMapSession;

  const [archiveReplay, setArchiveReplay] = useState(false);
  const ergastReplayOk = sessionSupportsErgastLapReplay(sessionType);
  const canErgastArchive = Boolean(year && round && !awaitingMapSession && ergastReplayOk);
  const ergastArchiveOnLive =
    trackMapActive && archiveReplay && canErgastArchive;
  const fetchErgastReplay =
    ergastReplayOk && (useHistoricalReplay || ergastArchiveOnLive);

  // ── Historical circuit + laps (full-screen replay, or live tab “Lap replay”) ─
  const {
    data: circuitData,
    isLoading: circuitLoading,
    error: circuitError,
    refetch: refetchCircuitMap,
  } = useQuery({
    queryKey: ['circuit_map', year, round, raceName],
    queryFn: () => telemetry.circuitMap(year!, round!, raceName),
    enabled: fetchErgastReplay,
    staleTime: Infinity,
    retry: 1,
  });

  const { data: lapEvoData } = useQuery({
    queryKey: ['lap_evolution', year, round],
    queryFn: () => history.lapEvolution(year!, round!),
    enabled: fetchErgastReplay,
    staleTime: 10 * 60 * 1000,
  });

  // ── Driver colours ─────────────────────────────────────────────────────────
  const { data: raceResults } = useQuery({
    queryKey: ['race_results', year, round],
    queryFn: () => history.raceResults(year!, round!),
    enabled: fetchErgastReplay,
    staleTime: 10 * 60 * 1000,
  });

  const { data: ergastQualiRows, isLoading: ergastQualiLoading } = useQuery({
    queryKey: ['qualifying', year, round],
    queryFn: () => history.qualifying(year!, round!),
    enabled: trackMapActive && year != null && round != null && isQualiUi,
    staleTime: 60 * 1000,
  });

  /** Warm FastF1 circuit while on live map so Lap replay opens faster. */
  useEffect(() => {
    if (!trackMapActive || year == null || round == null || !ergastReplayOk) return;
    void queryClient.prefetchQuery({
      queryKey: ['circuit_map', year, round, raceName ?? ''],
      queryFn: () => telemetry.circuitMap(year, round, raceName),
      staleTime: Infinity,
    });
  }, [trackMapActive, year, round, raceName, ergastReplayOk, queryClient]);

  const driverColors = useMemo(() => {
    const m = new Map<string, { color: string; code: string }>();
    ((raceResults?.length ? raceResults : null) ?? lastRaceReport?.results ?? []).forEach((r: any) => {
      const id          = r.Driver?.driverId ?? '';
      const code        = r.Driver?.code ?? id.toUpperCase().slice(0, 3);
      const constructor = r.Constructor?.constructorId ?? '';
      const teamColors: Record<string, string> = {
        red_bull: '#3671C6', mercedes: '#27F4D2', ferrari: '#E8002D',
        mclaren: '#FF8000',  aston_martin: '#229971', alpine: '#FF87BC',
        williams: '#64C4FF', haas: '#B6BABD', rb: '#6692FF',
        racing_bulls: '#6692FF', kick_sauber: '#52E252', sauber: '#52E252', audi: '#9B9B9B',
      };
      m.set(id, { color: teamColors[constructor] ?? Colors.primary, code });
    });
    return m;
  }, [raceResults, lastRaceReport]);

  // ── Playback state ─────────────────────────────────────────────────────────
  // currentTime is a float: 1.0 = start of lap 1, 57.0 = end of lap 57.
  // Between integer N and N+1, cars smoothly drive one full circuit + position delta.
  const [currentTime, setCurrentTime] = useState(1.0);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [speed,       setSpeed]       = useState(1);
  const [highlightedSector, setHighlightedSector] = useState<SectorId | null>(null);

  const totalLaps = Math.max(1, (() => {
    if ((lapEvoData?.laps?.length ?? 0) > 0) {
      return Math.max(...lapEvoData!.laps.map((l: any) => Number(l.lap) || 0));
    }
    const n = parseInt((raceResults ?? lastRaceReport?.results ?? [])[0]?.laps ?? '57', 10);
    return Number.isFinite(n) && n > 0 ? n : 57;
  })());

  // Refs to avoid stale closures in RAF loop
  const isPlayingRef   = useRef(false);
  const speedRef       = useRef(1);
  const totalLapsRef   = useRef(57);
  const lastTsRef      = useRef(0);
  const rafRef         = useRef<number | null>(null);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { totalLapsRef.current = totalLaps; }, [totalLaps]);

  // RAF-based continuous animation — 60 fps, no setInterval jank
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = 0;
      return;
    }

    const animate = (ts: number) => {
      if (!isPlayingRef.current) return;
      if (lastTsRef.current === 0) lastTsRef.current = ts;
      const elapsed  = ts - lastTsRef.current;
      lastTsRef.current = ts;

      const msPerLap  = BASE_MS_PER_LAP / speedRef.current;
      const increment = elapsed / msPerLap;

      setCurrentTime(prev => {
        const next = prev + increment;
        if (next >= totalLapsRef.current) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          return totalLapsRef.current;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  // Reset when session changes
  useEffect(() => { setCurrentTime(1.0); setIsPlaying(false); }, [year, round]);
  useEffect(() => {
    setHighlightedSector(null);
    setArchiveReplay(false);
  }, [effectiveKey, selectedSessionKey]);
  /**
   * Only leave Lap replay when the session is clearly not race/sprint (e.g. Qualifying).
   * Do not tie this to year/round flicker — that caused replay UI to vanish mid-session.
   */
  useEffect(() => {
    if (archiveReplay && !ergastReplayOk) setArchiveReplay(false);
  }, [archiveReplay, ergastReplayOk]);

  // ── Pre-compute arc fractions for every lap ─────────────────────────────────
  // allLapFracs[lapIndex] = Map<driverId, arcFraction>  (lapIndex = lap-1)
  const allLapFracs = useMemo(() => {
    if (totalLaps <= 0) return [];

    const byLap = new Map<number, Map<string, number>>();
    for (const l of lapEvoData?.laps ?? []) {
      const lap      = Number((l as { lap?: number }).lap);
      const driverId = String((l as { driverId?: string }).driverId ?? '');
      const pos      = parseInt(String((l as { position?: number }).position ?? '0'), 10) || 0;
      if (!driverId || pos <= 0 || !lap) continue;
      if (!byLap.has(lap)) byLap.set(lap, new Map());
      byLap.get(lap)!.set(driverId, pos);
    }

    const SPREAD = 0.72;
    const fillFromPositions = (positions: Map<string, number>) => {
      const fracMap = new Map<string, number>();
      const sorted  = Array.from(positions.entries()).sort((a, b) => a[1] - b[1]);
      const total   = sorted.length;
      const gapFrac = total > 1 ? SPREAD / (total - 1) : 0;
      sorted.forEach(([id], idx) => {
        fracMap.set(id, Math.max(0.05, 0.98 - idx * gapFrac));
      });
      return fracMap;
    };

    const result: Map<string, number>[] = [];
    let lastFrac: Map<string, number> | null = null;

    for (let lap = 1; lap <= totalLaps; lap++) {
      const positions = byLap.get(lap);
      let fracMap     = new Map<string, number>();
      if (positions && positions.size > 0) {
        fracMap   = fillFromPositions(positions);
        lastFrac = fracMap;
      } else if (lastFrac && lastFrac.size > 0) {
        lastFrac.forEach((v, k) => fracMap.set(k, v));
      }
      result.push(fracMap);
    }

    const firstIdx = result.findIndex(m => m.size > 0);
    if (firstIdx > 0) {
      const seed = result[firstIdx];
      for (let i = 0; i < firstIdx; i++) {
        const fm = new Map<string, number>();
        seed.forEach((v, k) => fm.set(k, v));
        result[i] = fm;
      }
    }

    if (result.length && result.every(m => m.size === 0) && driverColors.size > 0) {
      const ids = [...driverColors.keys()].sort();
      const n   = ids.length;
      const gapFrac = n > 1 ? SPREAD / (n - 1) : 0;
      const syn = new Map<string, number>();
      ids.forEach((id, idx) => syn.set(id, Math.max(0.05, 0.98 - idx * gapFrac)));
      for (let i = 0; i < result.length; i++) result[i] = new Map(syn);
    }

    return result;
  }, [lapEvoData, totalLaps, driverColors]);

  // ── Circuit geometry — keep last good outline if a refetch returns empty (stops replay flicker)
  const lastReplayCircuitRef = useRef<Pt[]>([]);
  useEffect(() => {
    lastReplayCircuitRef.current = [];
  }, [year, round]);

  const circuitPath = useMemo(() => {
    const raw = coerceCircuitPoints(circuitData?.path as unknown[] | undefined);
    if (raw.length >= MIN_TRACK_POINTS) {
      lastReplayCircuitRef.current = raw;
      return raw;
    }
    if (fetchErgastReplay && lastReplayCircuitRef.current.length >= MIN_TRACK_POINTS) {
      return lastReplayCircuitRef.current;
    }
    return raw;
  }, [circuitData, fetchErgastReplay]);
  const replayArcs  = useMemo(() => buildArcs(circuitPath), [circuitPath]);
  const replayNorm  = useMemo(() => buildNorm(circuitPath, mapSize), [circuitPath, mapSize]);

  // ── Interpolated dots — runs every RAF frame ────────────────────────────────
  const replayDots: DotInfo[] = useMemo(() => {
    if (!allLapFracs.length || !replayNorm || !replayArcs.length || !circuitPath.length) return [];

    const lapFloat = currentTime - 1;                         // 0-indexed
    const lapIdx   = Math.max(0, Math.floor(lapFloat));
    const frac     = lapFloat - lapIdx;                       // 0..1 within this lap

    let fromLap = allLapFracs[Math.min(lapIdx,     allLapFracs.length - 1)];
    let toLap   = allLapFracs[Math.min(lapIdx + 1, allLapFracs.length - 1)];
    if (fromLap.size === 0) {
      const fallback = allLapFracs.find(m => m.size > 0);
      if (fallback) {
        fromLap = fallback;
        toLap   = toLap.size > 0 ? toLap : fallback;
      }
    }

    const rankById = new Map(
      [...fromLap.entries()].sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]),
    );
    const dots: DotInfo[] = [];
    fromLap.forEach((fromFrac, driverId) => {
      const toFrac      = toLap.get(driverId) ?? fromFrac;
      const arcFrac     = interpArcFrac(fromFrac, toFrac, frac);
      const pt          = ptAt(circuitPath, replayArcs, arcFrac);
      const { nx, ny }  = replayNorm(pt);
      const info        = driverColors.get(driverId);
      dots.push({
        key:      driverId,
        nx, ny,
        color:    info?.color ?? Colors.primary,
        label:    info?.code  ?? driverId.toUpperCase().slice(0, 3),
        position: 0,
        rank:     rankById.get(driverId),
      });
    });
    return dots;
  }, [currentTime, allLapFracs, circuitPath, replayArcs, replayNorm, driverColors]);

  const legendItems = useMemo(
    () => Array.from(driverColors.entries()).map(([, v]) => v),
    [driverColors],
  );

  const displayTitle = trackMapActive
    ? 'TRACK MAP'
    : sessionType
    ? sessionType.toUpperCase()
    : 'RACE REPLAY';

  const displaySubtitle = resolvedPickedSession
    ? [
        resolvedPickedSession.circuit_short_name || resolvedPickedSession.location,
        resolvedPickedSession.country_name,
        expandQualifyingSessionName(resolvedPickedSession.session_name),
      ].filter(Boolean).join(' · ')
    : mapFocus?.circuit_short_name
    ? [
        mapFocus.circuit_short_name,
        mapFocus.country_name,
        expandQualifyingSessionName(mapFocus.session_name),
      ].filter(Boolean).join(' · ')
    : liveSession?.circuit_short_name
    ? [
        liveSession.circuit_short_name,
        liveSession.country_name,
        expandQualifyingSessionName(liveSession.session_name),
      ].filter(Boolean).join(' · ')
    : raceName ?? 'Loading…';

  const qualiTop10 = useMemo(() => {
    if (!ergastQualiRows?.length) return undefined;
    return [...ergastQualiRows]
      .sort((a, b) => parseInt(String(a.position), 10) - parseInt(String(b.position), 10))
      .slice(0, 10);
  }, [ergastQualiRows]);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>{displayTitle}</Text>
          <Text style={s.subtitle}>{displaySubtitle}</Text>
        </View>
        {trackMapActive && selectedSessionKey === 'latest' && mapFocus?.map_phase === 'live' && <LiveBadge />}
        {trackMapActive && selectedSessionKey === 'latest' && mapFocus?.map_phase === 'recent' && <RecentSessionBadge />}
      </View>

      {/* Session picker */}
      <View style={s.pickerRow}>
        <SessionPicker />
      </View>

      {trackMapActive && isQualiUi && (
        <View style={s.qualiStrip}>
          <Text style={s.qualiStripHint}>
            Top 10 grid: official Q1 / Q2 / Q3 times (Ergast). S1–S3 under the map are per-lap sector splits — not the same as qualifying sessions.
          </Text>
        </View>
      )}

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {trackMapActive ? (
          <>
            <View style={s.mapModeRow}>
              <TouchableOpacity
                style={[s.modeChip, !archiveReplay && s.modeChipActive]}
                onPress={() => setArchiveReplay(false)}
                activeOpacity={0.85}
              >
                <Text style={[s.modeChipTxt, !archiveReplay && s.modeChipTxtOn]}>LIVE MAP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.modeChip,
                  archiveReplay && s.modeChipActive,
                  !ergastReplayOk && s.modeChipDisabled,
                ]}
                onPress={() => ergastReplayOk && setArchiveReplay(true)}
                activeOpacity={ergastReplayOk ? 0.85 : 1}
                disabled={!ergastReplayOk}
              >
                <Text
                  style={[
                    s.modeChipTxt,
                    archiveReplay && s.modeChipTxtOn,
                    !ergastReplayOk && s.modeChipTxtDisabled,
                  ]}
                >
                  LAP REPLAY
                </Text>
                <Text style={[s.modeChipHint, !ergastReplayOk && s.modeChipTxtDisabled]}>
                  {ergastReplayOk ? '1×–5×' : 'race only'}
                </Text>
              </TouchableOpacity>
            </View>

            {!archiveReplay && mapFocus?.map_phase === 'recent' && (
              <View style={s.recentBanner}>
                <Text style={s.recentBannerTxt}>
                  Session finished — showing last OpenF1 telemetry for this weekend. Map updates when the next session starts.
                </Text>
      </View>
            )}
            {!archiveReplay && trackPathPending && !hasStableOutline && (
              <View style={s.trackPathLoad}>
                <ActivityIndicator color={Colors.primary} size="large" />
                <Text style={s.trackPathLoadTitle}>LOADING CIRCUIT OUTLINE</Text>
                <Text style={s.trackPathLoadSub}>
                  OpenF1 may lack a GPS outline — we fall back to FastF1 (cached on the server after the first request).
                </Text>
              </View>
            )}
            {!archiveReplay && trackPathFetchFailed && (
              <View style={s.errorBox}>
                <Text style={s.errorTitle}>TRACK OUTLINE FAILED</Text>
                <Text style={s.errorText}>Check backend logs / FastF1 cache. Pull to retry from the Race tab or restart the API.</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => refetchTrack()}>
                  <Text style={s.retryText}>RETRY</Text>
                </TouchableOpacity>
              </View>
            )}
            {!archiveReplay && hasStableOutline && (
              <View style={s.mapStage}>
                {trackPathFetching && !trackPathPending && (
                  <View style={s.mapRefreshBadge}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={s.mapRefreshTxt}>Syncing outline…</Text>
                  </View>
                )}
                <LiveMapView
                  positions={livePositions}
                  drivers={liveDrivers ?? []}
                  trackPath={displayTrackPath}
                  size={mapSize}
                  intervals={liveIntervals ?? undefined}
                  selectedSector={highlightedSector}
                  onSelectSector={setHighlightedSector}
                />
              </View>
            )}

            {archiveReplay && canErgastArchive && (
              <View style={[s.replaySection, { maxWidth: mapSize }]}>
                <Text style={s.replaySectionTitle}>RACE REPLAY · ERGAST LAPS</Text>
                <Text style={s.replaySectionSub}>
                  Play / pause and scrub below — speeds 1× to 5×. Uses last race lap order for this round.
                </Text>
                {circuitLoading && circuitPath.length < MIN_TRACK_POINTS && (
                  <CircuitLoading raceName={circuitLoadingLabel} />
                )}
                {!circuitLoading && circuitError && circuitPath.length < MIN_TRACK_POINTS && (
                  <View style={s.errorBox}>
                    <Text style={s.errorTitle}>LAP REPLAY UNAVAILABLE</Text>
                    <Text style={s.errorText}>
                      {circuitError instanceof Error && /timed out/i.test(circuitError.message)
                        ? 'The first circuit download can take 1–2 minutes; a short client timeout used to cancel before the server finished. Retry below — subsequent loads are cached and fast.'
                        : 'FastF1 could not load this circuit for Ergast lap replay. Use Live map, or check the API / network.'}
                      {circuitError instanceof Error && !/timed out/i.test(circuitError.message) && circuitError.message
                        ? `\n\n${circuitError.message}`
                        : ''}
                    </Text>
                    <TouchableOpacity style={s.retryBtn} onPress={() => refetchCircuitMap()}>
                      <Text style={s.retryText}>RETRY</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {circuitPath.length >= MIN_TRACK_POINTS && (
                  <>
                    {circuitData && circuitData.actual_year !== parseInt(String(year ?? 0)) && (
                      <View style={s.fallbackNote}>
                        <Text style={s.fallbackText}>⚡ Circuit layout from {circuitData.actual_year} — same track</Text>
                      </View>
                    )}
                    <View style={[s.mapStage, { minHeight: mapSize }]}>
                      <TrackSvg path={circuitPath} dots={replayDots} size={mapSize} />
                    </View>
                    {replayDots.length === 0 && lapEvoData != null && driverColors.size === 0 && (
                      <Text style={s.replayEmpty}>
                        No lap timing or grid for this round yet — replay needs Ergast race data.
                      </Text>
                    )}
                    <PlaybackBar
                      maxOuterWidth={mapSize}
                      currentTime={currentTime}
                      total={totalLaps}
                      isPlaying={isPlaying}
                      speed={speed}
                      onPlay={() => {
                        if (currentTime >= totalLaps) setCurrentTime(1.0);
                        setIsPlaying(p => !p);
                      }}
                      onSpeed={setSpeed}
                      onSeek={n => { setCurrentTime(n); setIsPlaying(false); }}
                    />
                    {legendItems.length > 0 && <DriverLegend items={legendItems} />}
                  </>
                )}
              </View>
            )}

            {!archiveReplay && (
              <View style={{ width: '100%', maxWidth: mapSize, alignSelf: 'center' }}>
                <FastestSectorsPanel
                  rows={sectorBestRows}
                  selectedSector={highlightedSector}
                  onSelectSector={setHighlightedSector}
                  loading={lapsSectorsLoading}
                  qualifyingMode={isQualifyingSessionName(sessionType)}
                />
                <DriverLegend
                  items={(liveDrivers ?? []).map(d => ({
                    code: d.name_acronym ?? String(d.driver_number),
                    color: d.team_colour ? `#${d.team_colour}` : Colors.primary,
                    headshot_url: headshotUri(d),
                  }))}
                />
              </View>
            )}
            <View style={{ width: '100%', maxWidth: mapSize, alignSelf: 'center' }}>
              {effectiveKey != null && <WeatherInsights sessionKey={effectiveKey} />}
            </View>

            {isQualiUi && (
              <View style={[s.qualiResultsWrap, { alignSelf: 'stretch' }]}>
                <QualifyingResultsPanel
                  rows={qualiTop10}
                  loading={ergastQualiLoading}
                  sprint={sprintQuali}
                />
              </View>
            )}
          </>
        ) : awaitingMapSession ? (
          <View style={s.waitBox}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={s.waitText}>Loading this weekend’s session…</Text>
          </View>
        ) : circuitLoading ? (
          <CircuitLoading raceName={circuitLoadingLabel} />
        ) : circuitError && circuitPath.length < MIN_TRACK_POINTS ? (
          <View style={s.errorBox}>
            <Text style={s.errorTitle}>CIRCUIT DATA UNAVAILABLE</Text>
            <Text style={s.errorText}>FastF1 could not download the circuit layout.{'\n'}Check the backend internet connection.</Text>
          </View>
        ) : circuitPath.length >= MIN_TRACK_POINTS || circuitData ? (
          <>
            {circuitData && circuitData.actual_year !== parseInt(String(year ?? 0)) && (
              <View style={s.fallbackNote}>
                <Text style={s.fallbackText}>⚡ Circuit layout from {circuitData.actual_year} — same track</Text>
              </View>
            )}

            <TrackSvg
              path={circuitPath}
              dots={replayDots}
              size={mapSize}
            />

            <PlaybackBar
              maxOuterWidth={mapSize}
              currentTime={currentTime}
              total={totalLaps}
              isPlaying={isPlaying}
              speed={speed}
              onPlay={() => {
                if (currentTime >= totalLaps) setCurrentTime(1.0);
                setIsPlaying(p => !p);
              }}
              onSpeed={setSpeed}
              onSeek={n => { setCurrentTime(n); setIsPlaying(false); }}
            />

            {effectiveKey != null && <WeatherInsights sessionKey={effectiveKey} />}
            <DriverLegend items={legendItems} />
          </>
        ) : !year ? (
          <View style={s.waitBox}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={s.waitText}>Loading race information…</Text>
          </View>
        ) : null}

        <View style={{ height: 80 }} />
    </ScrollView>
    </View>
  );
}

export default function LiveMapScreen() {
  return (
    <ErrorBoundary><MapContent /></ErrorBoundary>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerLeft: { flex: 1 },
  title:    { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 3 },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  pickerRow: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  qualiStrip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  qualiResultsWrap: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  qualiStripHint: {
    color: Colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  content:  { alignItems: 'center', paddingTop: Spacing.md, paddingHorizontal: Spacing.sm },
  mapModeRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: Spacing.sm,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  modeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  modeChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  modeChipTxt: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  modeChipTxtOn: {
    color: Colors.text,
  },
  modeChipHint: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  modeChipDisabled: {
    opacity: 0.4,
    borderColor: Colors.border,
  },
  modeChipTxtDisabled: {
    color: Colors.textMuted,
  },
  replaySection: {
    width: '100%',
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  replaySectionTitle: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 4,
  },
  replaySectionSub: {
    color: Colors.textMuted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  replayEmpty: {
    color: Colors.soft,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  mapStage: {
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  mapRefreshBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: '#0e0e18ee',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapRefreshTxt: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  recentBanner: {
    width: '100%',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: Spacing.sm,
  },
  recentBannerTxt: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  fallbackNote: {
    backgroundColor: Colors.surfaceHigh, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xs,
  },
  fallbackText: { color: Colors.textMuted, fontSize: 10, textAlign: 'center' },
  errorBox: {
    width: '100%', padding: Spacing.lg, backgroundColor: Colors.surface,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '50',
    alignItems: 'center', marginTop: Spacing.lg,
  },
  errorTitle: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 2 },
  errorText:  { color: Colors.textMuted, fontSize: FontSize.xs, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  retryBtn:   { marginTop: 12, borderWidth: 1, borderColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 8, borderRadius: Radius.sm },
  retryText:  { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  trackPathLoad: {
    width: '100%', alignItems: 'center', paddingVertical: 40, paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.sm, gap: 10,
  },
  trackPathLoadTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 2 },
  trackPathLoadSub:   { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  waitBox:  { alignItems: 'center', paddingTop: 80, gap: 16 },
  waitText: { color: Colors.textMuted, fontSize: FontSize.xs, letterSpacing: 1 },
});

const badge = StyleSheet.create({
  live:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1, backgroundColor: Colors.primary + '18', borderColor: Colors.primary + '60' },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  liveText: { color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  recent:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1, backgroundColor: Colors.surfaceHigh, borderColor: Colors.textMuted + '80' },
  recentText: { color: Colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
});

const mapS = StyleSheet.create({
  container: {
    backgroundColor: '#050508',
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: '#9333ea44',
    overflow: 'visible',
    marginVertical: Spacing.sm,
    shadowColor: '#9333ea',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
});

const pb = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: '#0c0c14',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#9333ea55',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  playBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 16, marginLeft: 2 },
  lapGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 2, flex: 1 },
  lapWord:  { color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 2 },
  lapNum:   { color: Colors.primary, fontSize: 22, fontWeight: '900', marginLeft: 4 },
  lapTotal: { color: Colors.textMuted, fontSize: FontSize.sm },
  arrowGroup: { flexDirection: 'row', gap: 4 },
  arrowBtn:   { backgroundColor: Colors.surfaceHigh, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: Colors.border },
  arrowTxt:   { color: Colors.text, fontSize: 13, fontWeight: '700' },
  speedGroup: { flexDirection: 'row', gap: 4 },
  speedBtn:   { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 5, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHigh },
  speedBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  speedTxt:   { color: Colors.textSecondary, fontSize: 10, fontWeight: '800' },
  speedTxtActive: { color: '#fff' },
  ticks: { paddingHorizontal: Spacing.sm, gap: 5, alignItems: 'center', paddingVertical: 8 },
  tick: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHigh, minWidth: 36, alignItems: 'center' },
  tickActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tickLbl:    { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  tickLblActive: { color: '#fff' },
});

const wxS = StyleSheet.create({
  card:    { width: '100%', marginTop: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm },
  cardWet: { borderColor: Colors.wet + '60' },
  heading: { color: Colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  row:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  item:    { alignItems: 'center', paddingHorizontal: Spacing.sm },
  label:   { color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  value:   { fontSize: FontSize.sm, fontWeight: '800', marginTop: 1 },
  divider: { width: 1, height: 28, backgroundColor: Colors.border },
  rainText: { color: Colors.wet, fontSize: FontSize.xs, fontWeight: '800' },
  rainSub:  { color: Colors.textMuted, fontSize: 9 },
});

const legS = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.md, justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  dot:  { width: 8, height: 8, borderRadius: 4 },
  face: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surfaceHigh },
  code: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
});

const loadS = StyleSheet.create({
  box:      { width: '100%', alignItems: 'center', padding: Spacing.xl, paddingTop: 48, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, marginTop: Spacing.md },
  icon:     { fontSize: 40, marginBottom: Spacing.md },
  title:    { color: Colors.text, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 3, marginBottom: Spacing.xs },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.xs, marginBottom: Spacing.sm },
  note:     { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 18, marginTop: Spacing.sm },
});
