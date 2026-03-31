/**
 * RaceHub — F1 race view.
 * Shows live leaderboard during active sessions, race analytics otherwise.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  TouchableOpacity, Animated,
} from 'react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { live, history } from '../lib/api';
import type { Meeting, Session, SessionEntry } from '../lib/api';
import {
  ergastRoundForOpenF1Focus,
  pickRaceHubAnalysisTarget,
} from '../lib/openF1ErgastMatch';
import type { Driver, RaceControlMsg, Weather } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { useRaceStore } from '../store/raceStore';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LeaderboardSkeleton } from '../components/Skeleton';
import RaceAnalysis from './RaceAnalysis';
import { useStableLiveList } from '../hooks/useStableLiveList';
import { decodeSyntheticSessionKey } from '../lib/sessionKeys';
import {
  finishedDefaultSessionQueryKey,
  FINISHED_DEFAULT_SESSION_STALE_MS,
} from '../lib/finishedSessionQuery';
import { isHistoricalOnly } from '../lib/config';
import { sessionIsLive } from '../lib/sessionLive';

// ── Tyre compound colours ──────────────────────────────────────────────────────

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: Colors.soft,
  MEDIUM: Colors.medium,
  HARD: Colors.hard,
  INTERMEDIATE: Colors.intermediate,
  WET: Colors.wet,
};

const COMPOUND_ABBR: Record<string, string> = {
  SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W',
};

function TyreBadge({ compound, age }: { compound?: string; age?: number }) {
  const color = compound ? COMPOUND_COLORS[compound] ?? Colors.textMuted : Colors.textMuted;
  const abbr = compound ? COMPOUND_ABBR[compound] ?? '?' : '?';
  return (
    <View style={[styles.tyreBadge, { borderColor: color }]}>
      <View style={[styles.tyreDot, { backgroundColor: color }]} />
      <Text style={[styles.tyreAbbr, { color }]}>{abbr}</Text>
      {age !== undefined && (
        <Text style={styles.tyreAge}>{age}L</Text>
      )}
    </View>
  );
}

// ── Live pulse indicator ───────────────────────────────────────────────────────

function LivePulse() {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.2, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <View style={styles.liveTag}>
      <Animated.View style={[styles.liveDot, { opacity: anim }]} />
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

// ── Weather bar ────────────────────────────────────────────────────────────────

function WeatherBar({ weather }: { weather: Weather }) {
  const isWet = (weather.rainfall ?? 0) > 0;
  return (
    <View style={[styles.weatherBar, isWet && styles.weatherBarWet]}>
      <View style={styles.weatherItem}>
        <Text style={styles.weatherLabel}>AIR</Text>
        <Text style={styles.weatherValue}>{weather.air_temperature?.toFixed(1) ?? '—'}°</Text>
      </View>
      <View style={styles.weatherDivider} />
      <View style={styles.weatherItem}>
        <Text style={styles.weatherLabel}>TRACK</Text>
        <Text style={[styles.weatherValue, { color: Colors.soft }]}>
          {weather.track_temperature?.toFixed(1) ?? '—'}°
        </Text>
      </View>
      <View style={styles.weatherDivider} />
      <View style={styles.weatherItem}>
        <Text style={styles.weatherLabel}>WIND</Text>
        <Text style={styles.weatherValue}>{weather.wind_speed?.toFixed(0) ?? '—'} km/h</Text>
      </View>
      {isWet && (
        <>
          <View style={styles.weatherDivider} />
          <View style={[styles.weatherItem, styles.weatherRain]}>
            <Text style={styles.weatherRainText}>🌧 RAIN</Text>
          </View>
        </>
      )}
    </View>
  );
}

// ── Driver row ─────────────────────────────────────────────────────────────────

function DriverRow({ driver, index }: { driver: Driver; index: number }) {
  const setSelected = useRaceStore((s) => s.setSelectedDriver);
  const teamColor = driver.team_colour ? `#${driver.team_colour}` : Colors.primary;
  const isLeader = index === 0;
  const isPodium = index < 3;

  return (
    <TouchableOpacity
      style={[styles.driverRow, isPodium && styles.driverRowPodium]}
      onPress={() => setSelected(driver.driver_number)}
      activeOpacity={0.75}
    >
      {/* Team colour stripe */}
      <View style={[styles.teamStripe, { backgroundColor: teamColor }]} />

      {/* Position */}
      <View style={[styles.posBox, isPodium && { borderColor: teamColor + '88' }]}>
        <Text style={[styles.posText, isPodium && { color: teamColor }]}>{index + 1}</Text>
      </View>

      {/* Driver info */}
      <View style={styles.driverInfo}>
        <Text style={styles.acronym}>{driver.name_acronym ?? `#${driver.driver_number}`}</Text>
        <Text style={styles.teamName} numberOfLines={1}>
          {driver.team_name ?? ''}
        </Text>
      </View>

      {/* Tyre */}
      <TyreBadge compound={driver.compound} age={driver.tyre_age} />

      {/* Gap */}
      <View style={styles.gapBox}>
        {isLeader ? (
          <Text style={[styles.leaderTag, { color: teamColor }]}>◈ LEAD</Text>
        ) : (
          <>
            <Text style={styles.gapText}>{driver.gap_to_leader ?? '—'}</Text>
            {driver.interval && (
              <Text style={styles.intervalText}>{driver.interval}</Text>
            )}
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Race control message ───────────────────────────────────────────────────────

const FLAG_COLORS: Record<string, string> = {
  GREEN: Colors.greenFlag,
  YELLOW: Colors.safetyCarYellow,
  RED: Colors.redFlag,
  BLUE: '#0072CE',
  CHEQUERED: Colors.text,
};

const FLAG_ICONS: Record<string, string> = {
  GREEN: '🟢',
  YELLOW: '🟡',
  RED: '🔴',
  BLUE: '🔵',
  CHEQUERED: '🏁',
};

function RCMessage({ msg }: { msg: RaceControlMsg }) {
  const color = msg.flag ? FLAG_COLORS[msg.flag] ?? Colors.textSecondary : Colors.textSecondary;
  const icon = msg.flag ? FLAG_ICONS[msg.flag] ?? '📻' : '📻';
  return (
    <View style={[styles.rcRow, { borderLeftColor: color }]}>
      <Text style={styles.rcIcon}>{icon}</Text>
      <View style={styles.rcContent}>
        {msg.lap_number && (
          <Text style={styles.rcLap}>LAP {msg.lap_number}</Text>
        )}
        <Text style={styles.rcText} numberOfLines={3}>{msg.message}</Text>
      </View>
    </View>
  );
}

// ── Live leaderboard ───────────────────────────────────────────────────────────

function LiveLeaderboard({
  sessionKey,
  mapBannerSource,
}: {
  sessionKey: number | 'latest';
  /** Prefer map_session row so the banner is not “Unknown Circuit” while /session lags. */
  mapBannerSource?: Session | SessionEntry | null;
}) {
  const { data, isPending, refetch, isRefetching, error } = useQuery({
    queryKey: ['race_snapshot', sessionKey],
    queryFn: () => live.snapshot(sessionKey),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

  /**
   * GET /live/session is the *global* latest row — never mix it with a specific session_key
   * or the banner shows the wrong circuit (e.g. Japan while you picked Melbourne).
   */
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: () => live.session(),
    enabled: sessionKey === 'latest',
    refetchInterval: 15000,
  });

  const driversStable = useStableLiveList(sessionKey, true, data?.drivers);
  const drivers = driversStable ?? [];

  const bannerCircuit =
    mapBannerSource?.circuit_short_name ?? session?.circuit_short_name;
  const bannerCountry = mapBannerSource?.country_name ?? session?.country_name;
  const bannerSession = mapBannerSource?.session_name ?? session?.session_name;
  const showBanner = !!(bannerCircuit || bannerCountry || bannerSession || session);

  const renderDriver = useCallback(
    ({ item, index }: { item: Driver; index: number }) => (
      <DriverRow driver={item} index={index} />
    ),
    []
  );

  if (isPending && data === undefined) {
    return (
      <View style={styles.container}>
        <LeaderboardSkeleton rows={20} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>⚠</Text>
        <Text style={styles.errorTitle}>NO SESSION DATA</Text>
        <Text style={styles.errorSub}>{(error as Error).message}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rcMessages = (data?.race_control ?? []).slice(0, 8);
  const weather = data?.weather;

  const ListHeader = (
    <>
      {showBanner && (
        <View style={styles.sessionBanner}>
          <View>
            <Text style={styles.sessionCircuit}>
              {bannerCircuit ?? 'Circuit'}
            </Text>
            <Text style={styles.sessionName}>
              {bannerCountry ? `${bannerCountry} · ` : ''}
              {bannerSession ?? 'Live timing'}
            </Text>
          </View>
          <LivePulse />
        </View>
      )}
      {weather && <WeatherBar weather={weather} />}
      <View style={styles.tableHeader}>
        <Text style={[styles.colLabel, { width: 32 }]}>POS</Text>
        <Text style={[styles.colLabel, { flex: 1 }]}>DRIVER</Text>
        <Text style={[styles.colLabel, { width: 68 }]}>TYRE</Text>
        <Text style={[styles.colLabel, { width: 80, textAlign: 'right' }]}>GAP</Text>
      </View>
    </>
  );

  const ListFooter = rcMessages.length > 0 ? (
    <View style={styles.rcSection}>
      <Text style={styles.sectionHeader}>RACE CONTROL</Text>
      {rcMessages.map((m, i) => (
        <RCMessage key={i} msg={m} />
      ))}
      <View style={styles.rcFooter} />
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <FlatList
        data={drivers}
        keyExtractor={(d) => String(d.driver_number)}
        renderItem={renderDriver}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ── Smart router: live vs historical ──────────────────────────────────────────

/**
 * RACE hub: OpenF1 timing tower **only** while the session window is actually active
 * (`sessionIsLive` from date_start/date_end + status). After chequered, always land on
 * Ergast results — do not use map_phase=recent or a pre–map_session “latest” snapshot
 * (that was flashing the tower first, then replacing it with the results page).
 */
function RaceHubOpenF1Driven() {
  const historicalHub = isHistoricalOnly();
  const { data: mapFocus, isFetched: mapFetched } = useQuery({
    queryKey: ['map_session'],
    queryFn: () => live.mapSession(),
    enabled: !historicalHub,
    refetchInterval: historicalHub ? false : 10_000,
    placeholderData: keepPreviousData,
  });

  const scheduleYear =
    mapFocus?.year != null && !Number.isNaN(Number(mapFocus.year))
      ? String(mapFocus.year)
      : String(new Date().getFullYear());

  const { data: schedule } = useQuery({
    queryKey: ['schedule', scheduleYear],
    queryFn: () => history.schedule(scheduleYear),
    enabled: !historicalHub,
    staleTime: 60 * 60 * 1000,
  });

  const {
    data: finishedDefault,
    isFetched: finishedDefaultFetched,
    isError: finishedDefaultError,
  } = useQuery({
    queryKey: [...finishedDefaultSessionQueryKey()],
    queryFn: () => history.finishedDefaultSession(),
    enabled: !historicalHub,
    staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
  });

  const showLiveBoard =
    !historicalHub
    && mapFetched
    && mapFocus != null
    && mapFocus.session_key != null
    && sessionIsLive(mapFocus);

  const analysisTarget = useMemo(() => {
    if (finishedDefault) {
      return { year: String(finishedDefault.year), round: String(finishedDefault.round) };
    }
    if (finishedDefaultError) {
      return pickRaceHubAnalysisTarget(mapFocus, schedule, scheduleYear);
    }
    return null;
  }, [finishedDefault, finishedDefaultError, mapFocus, schedule, scheduleYear]);

  const analysisDataReady =
    (finishedDefaultFetched || finishedDefaultError) && analysisTarget != null;

  if (!historicalHub && !mapFetched) {
    return (
      <View style={styles.container}>
        <LeaderboardSkeleton rows={10} />
      </View>
    );
  }

  if (showLiveBoard) {
    return (
      <LiveLeaderboard
        sessionKey={mapFocus!.session_key as number}
        mapBannerSource={mapFocus ?? undefined}
      />
    );
  }

  if (!analysisDataReady || analysisTarget === null) {
    return (
      <View style={styles.container}>
        <LeaderboardSkeleton rows={10} />
      </View>
    );
  }

  return (
    <RaceAnalysis
      year={analysisTarget.year}
      round={analysisTarget.round}
      cacheScope="hub-openf1-default"
    />
  );
}

function findMeetingForSessionRow(
  meetings: Meeting[] | undefined,
  row: SessionEntry | undefined,
): Meeting | undefined {
  if (!meetings?.length || !row) return undefined;
  const mk = row.meeting_key;
  const byKey = meetings.find((m) => Number(m.meeting_key) === Number(mk));
  if (byKey) return byKey;
  const rc = (row.circuit_short_name || '').trim().toLowerCase();
  const loc = (row.location || '').trim().toLowerCase();
  if (!rc && !loc) return undefined;
  return meetings.find((m) => {
    const mc = (m.circuit_short_name || '').trim().toLowerCase();
    const cn = (m.country_name || '').trim().toLowerCase();
    if (rc && mc && (rc === mc || rc.includes(mc) || mc.includes(rc))) return true;
    if (loc && cn && (loc === cn || loc.includes(cn))) return true;
    return false;
  });
}

/** After this grace period post-chequered, prefer Ergast if OpenF1 snapshot is empty. */
function sessionEndedForErgastFallback(row: SessionEntry | undefined): boolean {
  if (!row?.date_end) return false;
  const en = Date.parse(row.date_end);
  if (!Number.isFinite(en)) return false;
  return Date.now() > en + 2 * 60 * 60 * 1000;
}

/**
 * Picked OpenF1 session_key: use **snapshot(session_key)** for LIVE tab (always the right meeting).
 * Ergast RaceAnalysis only when the session is long finished and OpenF1 timing is gone.
 */
function RaceHubSessionResolved({ sessionKey }: { sessionKey: number }) {
  const { data: sessRows, isLoading: sessLoading } = useQuery({
    queryKey: ['sessions', 'by_key', sessionKey],
    queryFn: () => live.sessions(undefined, undefined, undefined, sessionKey),
    enabled: sessionKey > 0,
    staleTime: 60_000,
  });
  const row = sessRows?.[0];
  const yearNum =
    row?.year
    ?? (row?.date_start ? new Date(row.date_start).getUTCFullYear() : undefined)
    ?? new Date().getFullYear();

  const { data: meetings, isLoading: meetLoading } = useQuery({
    queryKey: ['meetings', yearNum],
    queryFn: () => live.meetings(yearNum),
    enabled: Number.isFinite(yearNum),
    staleTime: 5 * 60_000,
  });

  const meeting = findMeetingForSessionRow(meetings, row);
  const yearStr = String(row?.year ?? yearNum);

  const { data: scheduleForRound } = useQuery({
    queryKey: ['schedule', yearStr],
    queryFn: () => history.schedule(yearStr),
    enabled: sessionKey > 0 && Number.isFinite(yearNum),
    staleTime: 60 * 60 * 1000,
  });

  const round = useMemo(() => {
    const mr = meeting?.ergast_round;
    if (mr != null) return mr;
    const rw = row?.round;
    if (rw != null) return rw;
    const hit = ergastRoundForOpenF1Focus(
      scheduleForRound,
      yearStr,
      row?.location,
      row?.country_name,
    );
    if (hit == null) return undefined;
    const n = parseInt(hit.round, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [meeting, row, scheduleForRound, yearStr]);

  const {
    data: snap,
    isLoading: snapLoading,
    isFetched: snapFetched,
  } = useQuery({
    queryKey: ['race_snapshot', sessionKey],
    queryFn: () => live.snapshot(sessionKey),
    enabled: sessionKey > 0,
    staleTime: 4000,
  });

  const snapshotHasDrivers = (snap?.drivers?.length ?? 0) > 0;
  const useErgastFinished =
    snapFetched
    && !snapLoading
    && !snapshotHasDrivers
    && sessionEndedForErgastFallback(row)
    && row != null
    && round != null;

  if (sessLoading || meetLoading) {
    return (
      <View style={styles.container}>
        <LeaderboardSkeleton rows={10} />
      </View>
    );
  }

  if (useErgastFinished) {
    return (
      <RaceAnalysis
        year={yearStr}
        round={String(round)}
        cacheScope={sessionKey}
      />
    );
  }

  return (
    <LiveLeaderboard
      sessionKey={sessionKey}
      mapBannerSource={row ?? undefined}
    />
  );
}

function RaceHubContent() {
  const selectedSessionKey = useRaceStore((s) => s.selectedSessionKey);
  const historicalBrowseYear = useRaceStore((s) => s.historicalBrowseYear);

  const finishedDefaultYearArg =
    historicalBrowseYear != null && historicalBrowseYear !== ''
      ? historicalBrowseYear
      : undefined;

  /** Same cache as HistoricalDefaultSessionLoader — authoritative year/round vs decode drift. */
  const { data: finishedDefaultApi } = useQuery({
    queryKey: [...finishedDefaultSessionQueryKey(historicalBrowseYear)],
    queryFn: () => history.finishedDefaultSession(finishedDefaultYearArg),
    enabled:
      isHistoricalOnly()
      && (selectedSessionKey === 'pending'
        || (typeof selectedSessionKey === 'number' && selectedSessionKey < 0)),
    staleTime: FINISHED_DEFAULT_SESSION_STALE_MS,
  });

  if (selectedSessionKey === 'pending') {
    if (finishedDefaultApi) {
      return (
        <RaceAnalysis
          year={String(finishedDefaultApi.year)}
          round={String(finishedDefaultApi.round)}
          cacheScope={`pending-${finishedDefaultApi.session_key}`}
        />
      );
    }
    return (
      <View style={styles.container}>
        <LeaderboardSkeleton rows={10} />
      </View>
    );
  }

  if (typeof selectedSessionKey === 'number' && selectedSessionKey < 0) {
    const dec = decodeSyntheticSessionKey(selectedSessionKey);
    if (dec) {
      if (finishedDefaultApi && finishedDefaultApi.session_key === selectedSessionKey) {
        return (
          <RaceAnalysis
            year={String(finishedDefaultApi.year)}
            round={String(finishedDefaultApi.round)}
            cacheScope={selectedSessionKey}
          />
        );
      }
      return (
        <RaceAnalysis
          year={String(dec.year)}
          round={String(dec.round)}
          cacheScope={selectedSessionKey}
        />
      );
    }
  }

  // User explicitly picked a specific session — always resolve year/round from API + meetings
  // (Zustand round/year can disagree with OpenF1; React Query cache must key on session_key).
  if (typeof selectedSessionKey === 'number' && selectedSessionKey > 0) {
    return <RaceHubSessionResolved sessionKey={selectedSessionKey} />;
  }

  return <RaceHubOpenF1Driven />;
}

export default function RaceHub() {
  return (
    <ErrorBoundary>
      <RaceHubContent />
    </ErrorBoundary>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  list: { paddingBottom: Spacing.xl * 2 },

  // Session banner
  sessionBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sessionCircuit: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sessionName: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    letterSpacing: 1,
    marginTop: 2,
  },

  // Live pulse
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary + '22',
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  liveText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },

  // Weather
  weatherBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
    alignItems: 'center',
  },
  weatherBarWet: {
    borderBottomColor: Colors.wet + '66',
  },
  weatherItem: {
    alignItems: 'center',
  },
  weatherLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  weatherValue: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '700',
    marginTop: 2,
  },
  weatherDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.border,
  },
  weatherRain: {
    flexDirection: 'row',
  },
  weatherRainText: {
    color: Colors.wet,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },

  // Table header
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  colLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  // Driver row
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.md,
    marginBottom: 1,
    height: 54,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border + '44',
  },
  driverRowPodium: {
    borderColor: Colors.border,
  },
  teamStripe: {
    width: 3,
    height: '100%',
  },
  posBox: {
    width: 36,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: Colors.border + '44',
  },
  posText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '800',
  },
  driverInfo: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    justifyContent: 'center',
  },
  acronym: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '800',
    letterSpacing: 1,
  },
  teamName: {
    color: Colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 1,
  },

  // Tyre
  tyreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    width: 60,
    backgroundColor: Colors.background,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 3,
    marginRight: 4,
  },
  tyreDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  tyreAbbr: {
    fontSize: 11,
    fontWeight: '800',
  },
  tyreAge: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 1,
  },

  // Gap
  gapBox: {
    paddingRight: Spacing.md,
    alignItems: 'flex-end',
    minWidth: 80,
  },
  leaderTag: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  gapText: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  intervalText: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 1,
  },

  // Error
  errorIcon: { fontSize: 36, color: Colors.primary },
  errorTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '900',
    letterSpacing: 2,
  },
  errorSub: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    textAlign: 'center',
    maxWidth: 280,
  },
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

  // Race control
  sectionHeader: {
    color: Colors.textMuted,
    fontSize: 9,
    letterSpacing: 2.5,
    fontWeight: '700',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  rcSection: {
    marginTop: Spacing.xs,
  },
  rcRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: 6,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    gap: Spacing.sm,
  },
  rcIcon: { fontSize: 14, marginTop: 1 },
  rcContent: { flex: 1 },
  rcLap: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  rcText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  rcFooter: { height: Spacing.xl },
});
