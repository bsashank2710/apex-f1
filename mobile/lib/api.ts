/**
 * APEX API client — typed fetch wrappers for the FastAPI backend.
 * Base URL: EXPO_PUBLIC_API_URL, else deployed Cloud Run (see lib/config.ts).
 */

import { DEFAULT_API_BASE_URL } from './config';
import { getAnthropicAppKey } from './anthropicKey';

export { getAnthropicAppKey };

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_BASE_URL;
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

function requestHeaders(path: string): Record<string, string> {
  const h = authHeaders();
  const ak = getAnthropicAppKey();
  if (ak && path.startsWith('/ai/')) {
    h['X-Anthropic-Key'] = ak;
  }
  return h;
}

const FETCH_TIMEOUT_MS = 30_000;
/** Post-race intel: Ergast + large Claude JSON; 30s default often aborts before the model finishes. */
const INTEL_FETCH_TIMEOUT_MS = 120_000;
/** FastF1 circuit_map: server allows 180s; default 30s fetch caused false “unavailable” on first download. */
const CIRCUIT_MAP_FETCH_TIMEOUT_MS = 190_000;

async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  let res: Response;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    try {
      res = await fetch(url.toString(), { headers: requestHeaders(path), signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted =
      (e instanceof Error && e.name === 'AbortError')
      || (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
    if (aborted) {
      throw new Error(
        `Request timed out after ${timeoutMs / 1000}s. Is the API running at ${BASE_URL}? (Set EXPO_PUBLIC_API_URL if needed.)`,
      );
    }
    throw new Error(
      `${msg}. Is the API running at ${BASE_URL}? (Set EXPO_PUBLIC_API_URL if needed.)`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: requestHeaders(path),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const aborted =
      (e instanceof Error && e.name === 'AbortError')
      || (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError');
    if (aborted) {
      throw new Error(
        `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Is the API running at ${BASE_URL}?`,
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Live ──────────────────────────────────────────────────────────────────────

export const live = {
  snapshot: (sessionKey: string | number = 'latest') =>
    get<RaceSnapshot>('/live/race_snapshot', { session_key: sessionKey }),

  session: () => get<Session>('/live/session'),

  /** Best session for map + live widgets (handles gaps between FP/quali/sprint/race). */
  mapSession: () => get<MapFocusSession>('/live/map_session'),

  sessions: (
    year?: number,
    meetingKey?: number,
    sessionName?: string,
    sessionKey?: number,
  ) =>
    get<SessionEntry[]>('/live/sessions', {
      year,
      meeting_key: meetingKey,
      session_name: sessionName,
      session_key: sessionKey,
    }),

  meetings: (year?: number) =>
    get<Meeting[]>('/live/meetings', { year }),

  drivers: (sessionKey: string | number = 'latest') =>
    get<Driver[]>('/live/drivers', { session_key: sessionKey }),

  carData: (sessionKey: string | number = 'latest', driverNumber?: number) =>
    get<CarData[]>('/live/car_data', { session_key: sessionKey, driver_number: driverNumber }),

  position: (sessionKey: string | number = 'latest', driverNumber?: number) =>
    get<Position[]>('/live/position', { session_key: sessionKey, driver_number: driverNumber }),

  intervals: (sessionKey: string | number = 'latest') =>
    get<Interval[]>('/live/intervals', { session_key: sessionKey }),

  laps: (sessionKey: string | number = 'latest', driverNumber?: number) =>
    get<Lap[]>('/live/laps', { session_key: sessionKey, driver_number: driverNumber }),

  stints: (sessionKey: string | number = 'latest', driverNumber?: number) =>
    get<Stint[]>('/live/stints', { session_key: sessionKey, driver_number: driverNumber }),

  pits: (sessionKey: string | number = 'latest') =>
    get<Pit[]>('/live/pits', { session_key: sessionKey }),

  raceControl: (sessionKey: string | number = 'latest') =>
    get<RaceControlMsg[]>('/live/race_control', { session_key: sessionKey }),

  weather: (sessionKey: string | number = 'latest') =>
    get<Weather[]>('/live/weather', { session_key: sessionKey }),

  trackPath: (sessionKey: string | number = 'latest', driverNumber?: number) =>
    get<TrackPath>('/live/track_path', { session_key: sessionKey, driver_number: driverNumber }),

  raceMap: (sessionKey: number, lap: number) =>
    get<RaceMapResponse>(`/live/race_map/${sessionKey}`, { lap }),
};

// ── History ───────────────────────────────────────────────────────────────────

export const history = {
  schedule: (year: string | number = 'current') =>
    get<ErgastRace[]>(`/history/schedule/${year}`),

  /** Last completed GP as synthetic session (no OpenF1). */
  finishedDefaultSession: (year?: string | number) =>
    get<FinishedDefaultSession>('/history/finished_default_session', {
      year: year === undefined ? undefined : String(year),
    }),

  nextRace: () => get<ErgastRace>('/history/next_race'),

  raceResults: (year: string | number = 'current', round: string | number = 'last') =>
    get<ErgastResult[]>(`/history/results/${year}/${round}`),

  qualifying: (year: string | number = 'current', round: string | number = 'last') =>
    get<ErgastQualifying[]>(`/history/qualifying/${year}/${round}`),

  driverStandings: (year: string | number = 'current') =>
    get<DriverStanding[]>('/history/standings/drivers', { year: String(year) }),

  constructorStandings: (year: string | number = 'current') =>
    get<ConstructorStanding[]>('/history/standings/constructors', { year: String(year) }),

  seasonOverview: (year: string | number = 'current') =>
    get<SeasonOverview>('/history/season_overview', { year: String(year) }),

  drivers: (year: string | number = 'current') =>
    get<ErgastDriver[]>('/history/drivers', { year: String(year) }),

  pitStops: (year: string | number = 'current', round: string | number = 'last') =>
    get<ErgastPitStop[]>(`/history/pitstops/${year}/${round}`),

  raceReport: (year: string | number = 'current', round: string | number = 'last') =>
    get<FullRaceReport>(`/history/race_report/${year}/${round}`),

  lapEvolution: (year: string | number = 'current', round: string | number = 'last') =>
    get<LapEvolution>(`/history/lap_evolution/${year}/${round}`),
};

// ── Telemetry ─────────────────────────────────────────────────────────────────

function _telemetrySeg(s: string): string {
  return encodeURIComponent(s);
}

export const telemetry = {
  driverLaps: (
    year: number,
    event: string,
    session: string,
    driver: string,
    lap?: number,
    driverNumber?: number,
    meetingName?: string,
  ) =>
    get<DriverTelemetry>(
      `/telemetry/${year}/${_telemetrySeg(String(event))}/${_telemetrySeg(session)}/driver/${_telemetrySeg(driver)}`,
      {
        ...(lap != null ? { lap } : {}),
        ...(driverNumber != null ? { driver_number: driverNumber } : {}),
        ...(meetingName ? { meeting_name: meetingName } : {}),
      },
      { timeoutMs: 120_000 },
    ),

  compare: (
    year: number,
    event: string,
    session: string,
    drivers: string[],
    driverNumber?: number,
    meetingName?: string,
  ) =>
    get<TelemetryComparison>(
      `/telemetry/${year}/${_telemetrySeg(String(event))}/${_telemetrySeg(session)}/compare`,
      {
        drivers: drivers.join(','),
        ...(driverNumber != null ? { driver_number: driverNumber } : {}),
        ...(meetingName ? { meeting_name: meetingName } : {}),
      },
      { timeoutMs: 120_000 },
    ),

  sessionLaps: (year: number, event: string, session: string) =>
    get<SessionLaps>(`/telemetry/${year}/${event}/${session}/laps`),

  circuitMap: (year: number | string, round: number | string, eventName?: string) =>
    get<CircuitMapResponse>(
      `/telemetry/${year}/${round}/circuit_map`,
      eventName ? { event_name: eventName } : undefined,
      { timeoutMs: CIRCUIT_MAP_FETCH_TIMEOUT_MS },
    ),
};

// ── AI ────────────────────────────────────────────────────────────────────────

export const ai = {
  predict: (sessionKey: number, driverNumbers?: number[], context?: string) =>
    post<RacePrediction>('/ai/predict', { session_key: sessionKey, driver_numbers: driverNumbers, context }),

  strategy: (sessionKey = 'latest', driverNumber?: number) =>
    get<StrategyResponse>('/ai/strategy/' + sessionKey, { driver_number: driverNumber }),

  insight: (prompt: string, sessionKey?: number, contextData?: Record<string, unknown>) =>
    post<AIInsight>('/ai/insight', { prompt, session_key: sessionKey, context_data: contextData }),

  safetyCar: (sessionKey = 'latest') =>
    get<SafetyCarResponse>('/ai/safety_car/' + sessionKey),

  postRaceIntel: (year: string | number, round: string | number) =>
    get<PostRaceIntel>(`/ai/post_race_intel/${year}/${round}`, undefined, {
      timeoutMs: INTEL_FETCH_TIMEOUT_MS,
    }),
};

/** OpenF1 / JSON may stringify `driver_number`; Map lookups must use a stable number key. */
export function coerceDriverNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n =
    typeof v === 'number' && Number.isFinite(v)
      ? v
      : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Driver {
  driver_number: number;
  full_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
  country_code?: string;
  gap_to_leader?: string;
  interval?: string;
  compound?: string;
  tyre_age?: number;
  stint_number?: number;
}

export interface RaceSnapshot {
  session_key: string;
  drivers: Driver[];
  weather: Weather;
  race_control: RaceControlMsg[];
}

export interface Session {
  session_key: number;
  session_name?: string;
  session_type?: string;
  /** From API when present; otherwise infer live from date_start/date_end via sessionIsLive(). */
  status?: string;
  date_start?: string;
  date_end?: string;
  circuit_short_name?: string;
  country_name?: string;
  location?: string;
  year?: number;
  meeting_key?: number;
  /** From GET /live/map_session — live | recent | upcoming | single | unknown */
  map_phase?: 'live' | 'recent' | 'upcoming' | 'single' | 'unknown';
}

export type MapFocusSession = Session;

export interface CarData {
  date?: string;
  driver_number: number;
  rpm?: number;
  speed?: number;
  n_gear?: number;
  throttle?: number;
  brake?: number;
  drs?: number;
}

export interface Position {
  date?: string;
  driver_number: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface Interval {
  driver_number: number;
  gap_to_leader?: string;
  interval?: string;
}

export interface Lap {
  driver_number: number;
  lap_number?: number;
  lap_duration?: number;
  duration_sector_1?: number;
  duration_sector_2?: number;
  duration_sector_3?: number;
  is_pit_out_lap?: boolean;
}

export interface Stint {
  driver_number: number;
  stint_number?: number;
  lap_start?: number;
  lap_end?: number;
  compound?: string;
  tyre_age_at_start?: number;
}

export interface Pit {
  driver_number: number;
  lap_number?: number;
  pit_duration?: number;
}

export interface RaceControlMsg {
  date?: string;
  driver_number?: number;
  lap_number?: number;
  category?: string;
  flag?: string;
  message?: string;
}

export interface Weather {
  air_temperature?: number;
  track_temperature?: number;
  humidity?: number;
  pressure?: number;
  rainfall?: number;
  wind_speed?: number;
  wind_direction?: number;
}

export interface TrackPath {
  session_key: string | number;
  path: Array<{ x: number; y: number }>;
  /** openf1 = GPS trace; fastf1 = circuit layout (use interval dots, not raw GPS). */
  outline_source?: 'openf1' | 'fastf1' | 'none';
}

export interface ErgastRace {
  season: string;
  round: string;
  raceName: string;
  date: string;
  time?: string;
  Circuit: { circuitName: string; Location: { country: string; locality: string } };
}

export interface ErgastResult {
  position: string;
  grid?: string;
  laps?: string;
  Time?: { millis?: string; time?: string };
  Driver: { familyName: string; givenName: string; code: string; driverId?: string };
  Constructor: { name: string; constructorId?: string };
  points: string;
  status: string;
  FastestLap?: { rank?: string; lap?: string; Time: { time: string } };
}

export interface ErgastQualifying {
  position: string;
  Driver: { familyName: string; code: string; driverId?: string };
  Constructor: { name: string; constructorId?: string };
  Q1?: string;
  Q2?: string;
  Q3?: string;
}

export interface ErgastPitStop {
  driverId: string;
  lap: string;
  stop: string;
  time: string;
  duration: string;
}

export interface RaceInfo {
  season?: string;
  round?: string;
  raceName?: string;
  date?: string;
  time?: string;
  Circuit?: { circuitName?: string; Location?: { country?: string; locality?: string } };
}

export interface FullRaceReport {
  race: RaceInfo | null;
  results: ErgastResult[];
  qualifying: ErgastQualifying[];
  pitstops: ErgastPitStop[];
}

export interface LapDataPoint {
  lap: number;
  driverId: string;
  position: number;
  time_s: number;
}

export interface LapEvolution {
  total: number;
  laps: LapDataPoint[];
}

export interface RaceMapResponse {
  lap: number;
  session_key: number;
  total_laps: number;
  positions: Position[];
}

export interface CircuitMapResponse {
  year: number;
  actual_year: number;
  round: number;
  event_name: string;
  path: Array<{ x: number; y: number }>;
}

export interface ErgastDriver {
  driverId: string;
  permanentNumber?: string;
  code?: string;
  givenName: string;
  familyName: string;
  nationality: string;
}

export interface DriverStanding {
  position: string;
  points: string;
  wins: string;
  Driver: ErgastDriver;
  Constructors: Array<{ name: string }>;
}

export interface ConstructorStanding {
  position: string;
  points: string;
  wins: string;
  Constructor: { name: string; nationality: string };
}

export interface SeasonOverview {
  year: string;
  schedule: ErgastRace[];
  driver_standings: DriverStanding[];
  constructor_standings: ConstructorStanding[];
}

export interface TelemetryPoint {
  time_ms: number;
  speed?: number;
  rpm?: number;
  gear?: number;
  throttle?: number;
  brake?: boolean;
  drs?: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface LapTelemetryData {
  driver: string;
  lap_number: number;
  lap_time?: string;
  compound?: string;
  tyre_life?: number;
  is_personal_best?: boolean;
  telemetry: TelemetryPoint[];
}

export interface DriverTelemetry {
  year: number;
  event: string;
  session: string;
  driver: string;
  laps: LapTelemetryData[];
}

export interface TelemetryComparison {
  year: number;
  event: string;
  session: string;
  comparisons: LapTelemetryData[];
}

export interface SessionLaps {
  year: number;
  event: string;
  session: string;
  laps: Array<{
    driver: string;
    driver_number?: number;
    lap_number?: number;
    lap_time?: string;
    compound?: string;
    tyre_life?: number;
    stint?: number;
  }>;
}

export interface StrategyRecommendation {
  driver_number: number;
  driver_name?: string;
  current_compound?: string;
  laps_on_tyre?: number;
  recommended_stop_lap?: number;
  recommended_compound?: string;
  reasoning: string;
}

export interface RacePrediction {
  session_key: number;
  predicted_winner?: string;
  podium: string[];
  safety_car_probability?: number;
  strategy_recommendations: StrategyRecommendation[];
  key_insights: string[];
  generated_at: string;
}

export interface StrategyResponse {
  session_key: string;
  recommendations: StrategyRecommendation[];
}

export interface AIInsight {
  insight: string;
  generated_at: string;
}

export interface PostRaceIntelDriverAnalysis {
  driver_code: string;
  driver_name: string;
  grid: number;
  finish: number;
  score: number;
  highlights: string[];
  mistakes: string[];
  tip: string;
}

export interface PostRaceIntel {
  year: string;
  round: string;
  /** Present from API v2: race | sprint | qualifying */
  intel_basis?: 'race' | 'sprint' | 'qualifying';
  /** e.g. Grand Prix, Sprint, Qualifying */
  session_focus?: string;
  headline: string;
  summary: string;
  driver_analysis: PostRaceIntelDriverAnalysis[];
  strategy_verdict: {
    best_team: string;
    worst_team: string;
    key_insight: string;
    pit_analysis: string;
  };
  what_ifs: string[];
  championship_impact: string;
  race_grade: string;
  grade_reason: string;
  generated_at: string;
}

export interface SafetyCarResponse {
  session_key: string;
  probability?: number;
  reasoning?: string;
}

export interface FinishedDefaultSession {
  session_key: number;
  meeting_key: number;
  year: number;
  round: number;
  session_name: string;
  meeting_name?: string;
  circuit_short_name?: string;
  country_name?: string;
  location?: string;
  date_start?: string;
}

export interface SessionEntry {
  session_key: number;
  session_name: string;
  session_type?: string;
  /** ISO datetime from OpenF1 — used to infer season when `year` is missing */
  date_start?: string;
  date_end?: string;
  circuit_short_name?: string;
  country_name?: string;
  meeting_key: number;
  year?: number;
  /** Ergast round number when known (synthetic / history default) */
  round?: number;
  meeting_name?: string;
  location?: string;
}

export interface Meeting {
  meeting_key: number;
  meeting_name?: string;
  meeting_official_name?: string;
  country_name?: string;
  country_code?: string;
  circuit_short_name?: string;
  circuit_key?: number;
  year?: number;
  date_start?: string;
  location?: string;
  /** Ergast round index when /live/meetings falls back to schedule-only rows */
  ergast_round?: number;
}
