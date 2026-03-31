import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Colors, FontSize } from '../../constants/theme';
import { View, Text, StyleSheet } from 'react-native';
import { useRaceStore } from '../../store/raceStore';
import { live } from '../../lib/api';
import { isHistoricalOnly } from '../../lib/config';

const TAB_ICONS: Record<string, string> = {
  index: '▶',
  map: '◎',
  intel: '✦',
  strategy: '◈',
  standings: '●',
  alerts: '◆',
};

const TAB_LABELS: Record<string, string> = {
  index: 'RACE',
  map: 'MAP',
  intel: 'INTEL',
  strategy: 'STRATEGY',
  standings: 'STANDINGS',
  alerts: 'ALERTS',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {TAB_ICONS[name] ?? '◉'}
    </Text>
  );
}

function AlertsIcon({ focused }: { focused: boolean }) {
  const unread = useRaceStore((s) => s.unreadCount)();
  return (
    <View>
      <TabIcon name="alerts" focused={focused} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </View>
  );
}

/** Warm OpenF1 timing caches on app load so RACE / TYRES / LAP LOG paint faster. */
function LiveOpenF1Prefetch() {
  const qc = useQueryClient();
  useEffect(() => {
    if (isHistoricalOnly()) return;
    void qc.prefetchQuery({
      queryKey: ['map_session'],
      queryFn: () => live.mapSession(),
      staleTime: 4000,
    });
    void qc.prefetchQuery({
      queryKey: ['race_snapshot', 'latest'],
      queryFn: () => live.snapshot('latest'),
      staleTime: 4000,
    });
    void qc.prefetchQuery({
      queryKey: ['session'],
      queryFn: () => live.session(),
      staleTime: 15_000,
    });
  }, [qc]);
  return null;
}

export default function TabLayout() {
  return (
    <>
      <LiveOpenF1Prefetch />
      <Tabs
      screenOptions={({ route }) => ({
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        headerStyle: styles.header,
        headerTintColor: Colors.text,
        headerTitleStyle: styles.headerTitle,
        headerLeft: () => (
          <View style={styles.headerLeft}>
            <Text style={styles.apexWord}>APEX</Text>
            <View style={styles.headerDivider} />
          </View>
        ),
        tabBarIcon: ({ focused }) =>
          route.name === 'alerts'
            ? <AlertsIcon focused={focused} />
            : <TabIcon name={route.name} focused={focused} />,
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'RACE HUB',
          tabBarLabel: TAB_LABELS['index'],
          headerTitle: 'RACE HUB',
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'LIVE MAP',
          tabBarLabel: TAB_LABELS['map'],
          headerTitle: 'LIVE MAP',
        }}
      />
      <Tabs.Screen
        name="intel"
        options={{
          title: 'AI INTEL',
          tabBarLabel: TAB_LABELS['intel'],
          headerTitle: 'AI INTEL',
          headerRight: () => (
            <View style={{ marginRight: 16 }}>
              <Text style={{ color: Colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 2 }}>
                POWERED BY CLAUDE
              </Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="strategy"
        options={{
          title: 'STRATEGY',
          tabBarLabel: TAB_LABELS['strategy'],
          headerTitle: 'STRATEGY',
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          title: 'CHAMPIONSHIP',
          tabBarLabel: TAB_LABELS['standings'],
          headerTitle: 'CHAMPIONSHIP',
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'ALERTS',
          tabBarLabel: TAB_LABELS['alerts'],
          headerTitle: 'ALERTS',
        }}
      />
    </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0E0E16',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    height: 64,
    paddingBottom: 10,
    paddingTop: 6,
  },
  tabItem: {
    gap: 2,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  icon: {
    fontSize: 18,
    color: Colors.textMuted,
  },
  iconFocused: {
    color: Colors.primary,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  header: {
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerTitle: {
    fontWeight: '900',
    letterSpacing: 3,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 16,
  },
  apexWord: {
    color: Colors.primary,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 4,
  },
  headerDivider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.border,
  },
});
