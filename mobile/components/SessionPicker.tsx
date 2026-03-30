/**
 * SessionPicker — compact session selector shared across all data screens.
 * Shows the currently selected session as a pill; on press opens a modal
 * to browse year → meeting → session type.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList,
  ActivityIndicator, Pressable, ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../lib/api';
import type { SessionEntry, Meeting } from '../lib/api';
import { useRaceStore } from '../store/raceStore';
import { useOpenF1LiveContext } from '../hooks/useOpenF1LiveContext';
import { expandQualifyingSessionName } from '../lib/sessionDisplay';
import { decodeSyntheticMeetingKey } from '../lib/sessionKeys';
import { isHistoricalOnly } from '../lib/config';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

/** Current season first; OpenF1/Ergast need an explicit year with meeting_key for sessions. */
function sessionPickerYears(): string[] {
  const y = new Date().getFullYear();
  return Array.from({ length: 10 }, (_, i) => String(y - i));
}

const SESSION_ORDER: Record<string, number> = {
  Race: 0,
  Qualifying: 1,
  'Sprint Qualifying': 2,
  Sprint: 3,
  'Practice 3': 4,
  'Practice 2': 5,
  'Practice 1': 6,
};

function sortSessions(a: SessionEntry, b: SessionEntry) {
  const aOrder = SESSION_ORDER[a.session_name] ?? 99;
  const bOrder = SESSION_ORDER[b.session_name] ?? 99;
  return aOrder - bOrder;
}

const SESSION_ICONS: Record<string, string> = {
  Race: '🏁',
  Qualifying: '⏱',
  'Sprint Qualifying': '⏱',
  Sprint: '🏃',
  'Practice 3': '🔵',
  'Practice 2': '🔵',
  'Practice 1': '🔵',
};

export function SessionPicker({ expandPill = false }: { expandPill?: boolean }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const selectedSessionKey = useRaceStore((s) => s.selectedSessionKey);
  const selectedSessionInfo = useRaceStore((s) => s.selectedSessionInfo);
  const setSelectedSessionKey = useRaceStore((s) => s.setSelectedSessionKey);
  const setSelectedSessionInfo = useRaceStore((s) => s.setSelectedSessionInfo);
  const { mapFocus } = useOpenF1LiveContext();

  const { data: meetings, isLoading: loadingMeetings } = useQuery({
    queryKey: ['meetings', year],
    queryFn: () => live.meetings(Number(year)),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions_for_meeting', year, selectedMeeting?.meeting_key],
    queryFn: () => live.sessions(Number(year), selectedMeeting!.meeting_key),
    enabled: open && !!selectedMeeting,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch the current session info for display
  const { data: currentSessionData } = useQuery({
    queryKey: ['session_info', selectedSessionKey],
    queryFn: () =>
      selectedSessionKey === 'latest'
        ? live.session()
        : live
            .sessions(undefined, undefined, undefined, Number(selectedSessionKey))
            .then((rows) => rows[0] ?? null),
    enabled:
      selectedSessionKey !== 'pending'
      && (selectedSessionKey === 'latest' || typeof selectedSessionKey === 'number'),
    staleTime: 60 * 1000,
  });

  const handleSelectSession = useCallback(
    (s: SessionEntry) => {
      const y = Number(year);
      const fromMk = decodeSyntheticMeetingKey(s.meeting_key);
      const ergR = selectedMeeting?.ergast_round;
      const enriched: SessionEntry = {
        ...s,
        year: s.year ?? fromMk?.year ?? (!Number.isNaN(y) ? y : s.year),
        round: s.round ?? ergR ?? fromMk?.round,
        meeting_name: s.meeting_name ?? selectedMeeting?.meeting_name,
      };
      setSelectedSessionKey(s.session_key);
      setSelectedSessionInfo(enriched);
      setOpen(false);
      setSelectedMeeting(null);
    },
    [setSelectedSessionKey, setSelectedSessionInfo, year, selectedMeeting]
  );

  const handleSelectLatest = useCallback(() => {
    setSelectedSessionKey('latest');
    setSelectedSessionInfo(null);
    setOpen(false);
    setSelectedMeeting(null);
  }, [setSelectedSessionKey, setSelectedSessionInfo]);

  const sessionLabel = () => {
    if (selectedSessionKey === 'pending') {
      return 'Loading session…';
    }
    if (typeof selectedSessionKey === 'number' && selectedSessionInfo?.session_key === selectedSessionKey) {
      const s = selectedSessionInfo;
      const place = [s.circuit_short_name, s.location].filter(Boolean).join(' · ');
      const sn = expandQualifyingSessionName(s.session_name);
      if (place || sn) return [place, sn].filter(Boolean).join(' · ');
    }
    if (selectedSessionKey === 'latest') {
      if (mapFocus && (mapFocus.circuit_short_name || mapFocus.location)) {
        const place = mapFocus.circuit_short_name ?? mapFocus.location ?? '';
        const line = [place, mapFocus.country_name].filter(Boolean).join(' · ');
        const sn = expandQualifyingSessionName(mapFocus.session_name);
        return line ? `${line} · ${sn || 'LATEST'}` : sn || 'LATEST SESSION';
      }
      if (currentSessionData && 'session_name' in currentSessionData) {
        const s = currentSessionData as SessionEntry;
        return `${s.circuit_short_name ?? ''} · ${expandQualifyingSessionName(s.session_name) || 'LATEST'}`;
      }
      return 'LATEST SESSION';
    }
    if (currentSessionData && 'session_name' in currentSessionData) {
      const s = currentSessionData as SessionEntry;
      return `${s.circuit_short_name ?? ''} · ${expandQualifyingSessionName(s.session_name)}`;
    }
    return `SESSION ${selectedSessionKey}`;
  };

  const sortedMeetings = [...(meetings ?? [])].sort(
    (a, b) => new Date(b.date_start ?? '').getTime() - new Date(a.date_start ?? '').getTime()
  );

  const sortedSessions = [...(sessions ?? [])].sort(sortSessions);

  return (
    <>
      <TouchableOpacity
        style={[styles.pill, expandPill && styles.pillExpand]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.pillIcon}>◎</Text>
        <Text style={styles.pillText} numberOfLines={1}>
          {sessionLabel()}
        </Text>
        <Text style={styles.pillChevron}>›</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />

        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>SELECT SESSION</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Live: true latest. Historical: same action — API default finished race (no way to get “live” without polling). */}
          <TouchableOpacity style={styles.latestBtn} onPress={handleSelectLatest}>
            <Text style={styles.latestBtnIcon}>⚡</Text>
            <Text style={styles.latestBtnText}>
              {isHistoricalOnly() ? 'DEFAULT FINISHED RACE' : 'LATEST SESSION'}
            </Text>
            {selectedSessionKey === 'latest' && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>

          {/* Year selector */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.yearRow}
          >
            {sessionPickerYears().map((y) => (
              <TouchableOpacity
                key={y}
                style={[styles.yearChip, year === y && styles.yearChipActive]}
                onPress={() => { setYear(y); setSelectedMeeting(null); }}
              >
                <Text style={[styles.yearText, year === y && styles.yearTextActive]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Meeting or Session list */}
          {selectedMeeting ? (
            <>
              <TouchableOpacity style={styles.backRow} onPress={() => setSelectedMeeting(null)}>
                <Text style={styles.backText}>‹ {selectedMeeting.country_name}</Text>
              </TouchableOpacity>
              {loadingSessions ? (
                <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
              ) : (
                <FlatList
                  data={sortedSessions}
                  keyExtractor={(s) => String(s.session_key)}
                  renderItem={({ item: s }) => (
                    <TouchableOpacity
                      style={[styles.sessionRow, selectedSessionKey === s.session_key && styles.sessionRowActive]}
                      onPress={() => handleSelectSession(s)}
                    >
                      <Text style={styles.sessionIcon}>
                        {SESSION_ICONS[s.session_name] ?? '◉'}
                      </Text>
                      <View style={styles.sessionInfo}>
                        <Text style={styles.sessionName} numberOfLines={2}>
                          {expandQualifyingSessionName(s.session_name)}
                        </Text>
                        {s.date_start && (
                          <Text style={styles.sessionDate}>
                            {new Date(s.date_start).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short',
                            })}
                          </Text>
                        )}
                      </View>
                      {selectedSessionKey === s.session_key && (
                        <Text style={styles.checkmark}>✓</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No sessions found</Text>
                  }
                />
              )}
            </>
          ) : (
            <>
              {loadingMeetings ? (
                <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
              ) : (
                <FlatList
                  data={sortedMeetings}
                  keyExtractor={(m) => String(m.meeting_key)}
                  renderItem={({ item: m }) => (
                    <TouchableOpacity
                      style={styles.meetingRow}
                      onPress={() => setSelectedMeeting(m)}
                    >
                      <View style={styles.meetingDateBox}>
                        <Text style={styles.meetingMonth}>
                          {m.date_start
                            ? new Date(m.date_start).toLocaleString('en-GB', { month: 'short' }).toUpperCase()
                            : '—'}
                        </Text>
                        <Text style={styles.meetingDay}>
                          {m.date_start ? new Date(m.date_start).getDate() : '—'}
                        </Text>
                      </View>
                      <View style={styles.meetingInfo}>
                        <Text style={styles.meetingName}>
                          {m.meeting_name ?? m.country_name ?? '—'}
                        </Text>
                        <Text style={styles.meetingCircuit}>
                          {m.circuit_short_name ?? m.location ?? ''}
                        </Text>
                      </View>
                      <Text style={styles.meetingChevron}>›</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      No rounds found for {year}. If your API is running, OpenF1 may be rejecting requests
                      (set OPENF1_USERNAME and OPENF1_PASSWORD on the backend), or the schedule source is down.
                    </Text>
                  }
                />
              )}
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start', maxWidth: 220,
  },
  pillExpand: {
    alignSelf: 'stretch', flex: 1, maxWidth: '100%', minWidth: 0,
  },
  pillIcon: { color: Colors.primary, fontSize: 11 },
  pillText: { color: Colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  pillChevron: { color: Colors.textMuted, fontSize: 14 },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderTopWidth: 1, borderColor: Colors.border,
    maxHeight: '75%', paddingBottom: Spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sheetTitle: {
    color: Colors.text, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 2,
  },
  closeBtn: { color: Colors.textSecondary, fontSize: 18, padding: 4 },

  latestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.primary + '11',
  },
  latestBtnIcon: { fontSize: 16 },
  latestBtnText: { flex: 1, color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700', letterSpacing: 1 },

  yearRow: {
    flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  yearChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  yearChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  yearText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },
  yearTextActive: { color: Colors.text },

  backRow: {
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700', letterSpacing: 0.5 },

  meetingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '55',
    gap: Spacing.sm,
  },
  meetingDateBox: {
    width: 40, alignItems: 'center',
    borderRightWidth: 1, borderRightColor: Colors.border, paddingRight: Spacing.sm,
  },
  meetingMonth: { color: Colors.primary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  meetingDay: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '900' },
  meetingInfo: { flex: 1 },
  meetingName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '700' },
  meetingCircuit: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
  meetingChevron: { color: Colors.textMuted, fontSize: 18 },

  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '55',
    gap: Spacing.sm,
  },
  sessionRowActive: { backgroundColor: Colors.primary + '11' },
  sessionIcon: { fontSize: 20 },
  sessionInfo: { flex: 1 },
  sessionName: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  sessionDate: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  checkmark: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '900' },

  emptyText: {
    color: Colors.textMuted, textAlign: 'center',
    padding: Spacing.xl, fontSize: FontSize.sm,
  },
});
