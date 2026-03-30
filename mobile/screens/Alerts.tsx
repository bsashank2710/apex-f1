/**
 * Alerts — push notification history and flag/safety car alert feed.
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { live } from '../lib/api';
import type { RaceControlMsg } from '../lib/api';
import { useRaceStore } from '../store/raceStore';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';
import { notifyRaceControlMessage } from '../lib/notifications';

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
  SAFETY_CAR: '🚗',
  VSC: '🐢',
};

function AlertItem({
  msg,
  onPress,
  read,
}: {
  msg: RaceControlMsg;
  onPress: () => void;
  read?: boolean;
}) {
  const flagColor = msg.flag ? FLAG_COLORS[msg.flag] ?? Colors.textSecondary : Colors.textSecondary;
  const icon = msg.flag ? FLAG_ICONS[msg.flag] ?? '📣' : '📣';
  const time = msg.date ? new Date(msg.date).toLocaleTimeString() : '';

  return (
    <TouchableOpacity
      style={[styles.alertRow, !read && styles.unread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.flagStripe, { backgroundColor: flagColor }]} />
      <View style={styles.alertContent}>
        <View style={styles.alertHeader}>
          <Text style={styles.alertIcon}>{icon}</Text>
          {msg.category && (
            <Text style={[styles.category, { color: flagColor }]}>{msg.category}</Text>
          )}
          {msg.lap_number && (
            <Text style={styles.lap}>Lap {msg.lap_number}</Text>
          )}
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.message}>{msg.message}</Text>
      </View>
      {!read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

export default function AlertsScreen() {
  const { alerts, markAlertRead, clearAlerts, addAlert } = useRaceStore();
  const seenDatesRef = useRef<Set<string>>(new Set());

  const { data: liveRc, refetch, isRefetching } = useQuery({
    queryKey: ['race_control_alerts'],
    queryFn: () => live.raceControl(),
    refetchInterval: 5000,
  });

  // Fire local notifications for new high-priority RC messages
  useEffect(() => {
    if (!liveRc) return;
    liveRc.forEach((msg) => {
      const key = (msg.date ?? '') + (msg.message ?? '');
      if (!key || seenDatesRef.current.has(key)) return;
      seenDatesRef.current.add(key);

      const isHighPriority =
        msg.flag === 'RED' ||
        msg.flag === 'CHEQUERED' ||
        msg.category === 'SafetyCar';

      if (isHighPriority) {
        notifyRaceControlMessage(msg);
        addAlert({
          type: msg.category === 'SafetyCar' ? 'safety_car' : 'flag',
          message: msg.message ?? msg.category ?? 'Race control',
          timestamp: msg.date ?? new Date().toISOString(),
          driverNumber: msg.driver_number,
        });
      }
    });
  }, [liveRc]);

  // Show live race control messages + stored app alerts
  const allMessages: RaceControlMsg[] = (liveRc ?? []).slice().reverse();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>ALERTS</Text>
        {alerts.length > 0 && (
          <TouchableOpacity onPress={clearAlerts}>
            <Text style={styles.clearText}>CLEAR ALL</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* App alerts (from store) */}
      {alerts.length > 0 && (
        <View style={styles.appAlertsSection}>
          <Text style={styles.sectionHeader}>APP NOTIFICATIONS</Text>
          {alerts.slice(0, 5).map((alert) => (
            <TouchableOpacity
              key={alert.id}
              style={[styles.appAlert, !alert.read && styles.unread]}
              onPress={() => markAlertRead(alert.id)}
            >
              <Text style={styles.appAlertType}>{alert.type.toUpperCase()}</Text>
              <Text style={styles.appAlertMessage}>{alert.message}</Text>
              {!alert.read && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Live race control feed */}
      <FlatList
        data={allMessages}
        keyExtractor={(item, i) => `${item.date}-${i}`}
        renderItem={({ item }) => (
          <AlertItem msg={item} onPress={() => {}} read={true} />
        )}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <Text style={styles.sectionHeader}>RACE CONTROL FEED</Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No race control messages yet.</Text>
            <Text style={styles.emptySubtext}>Messages will appear here during a live session.</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2 },
  clearText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },
  sectionHeader: {
    color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700',
    letterSpacing: 2, padding: Spacing.md, paddingBottom: Spacing.xs,
  },
  appAlertsSection: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  appAlert: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginBottom: 2,
    borderRadius: Radius.sm, padding: Spacing.sm, flexDirection: 'row', alignItems: 'center',
  },
  appAlertType: { color: Colors.primary, fontSize: 10, fontWeight: '700', marginRight: Spacing.sm },
  appAlertMessage: { flex: 1, color: Colors.text, fontSize: FontSize.sm },
  list: { paddingBottom: Spacing.xl },
  alertRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginBottom: 2,
    borderRadius: Radius.sm, overflow: 'hidden',
  },
  unread: { backgroundColor: Colors.surfaceHigh },
  flagStripe: { width: 4 },
  alertContent: { flex: 1, padding: Spacing.sm },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: 4 },
  alertIcon: { fontSize: 14 },
  category: { fontSize: FontSize.xs, fontWeight: '700', letterSpacing: 0.5, flex: 1 },
  lap: { color: Colors.textMuted, fontSize: 10 },
  time: { color: Colors.textMuted, fontSize: 10 },
  message: { color: Colors.text, fontSize: FontSize.sm, lineHeight: 18 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary,
    margin: Spacing.sm, alignSelf: 'center',
  },
  empty: { padding: Spacing.xxl, alignItems: 'center' },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
  emptySubtext: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 4, textAlign: 'center' },
});
