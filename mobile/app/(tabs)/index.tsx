// Race tab — LIVE, TYRES, LAP LOG, DRIVERS sub-screens
import RaceHub from '../../screens/RaceHub';
import TyreTracker from '../../screens/TyreTracker';
import LapLog from '../../screens/LapLog';
import DriverCards from '../../screens/DriverCards';
import { Colors, Spacing, FontSize } from '../../constants/theme';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useState } from 'react';

type SubScreen = 'hub' | 'tyres' | 'laps' | 'drivers';

const SUB_SCREENS: Array<{ id: SubScreen; label: string }> = [
  { id: 'hub', label: 'LIVE' },
  { id: 'tyres', label: 'TYRES' },
  { id: 'laps', label: 'LAP LOG' },
  { id: 'drivers', label: 'DRIVERS' },
];

function SubScreenContent({ screen }: { screen: SubScreen }) {
  switch (screen) {
    case 'hub': return <RaceHub />;
    case 'tyres': return <TyreTracker />;
    case 'laps': return <LapLog />;
    case 'drivers': return <DriverCards />;
  }
}

export default function RaceTab() {
  const [active, setActive] = useState<SubScreen>('hub');

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Sub-navigation — underline style */}
      <View style={styles.subNav}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subNavContent}
        >
          {SUB_SCREENS.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.subNavItem}
              onPress={() => setActive(s.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.subNavLabel, active === s.id && styles.subNavLabelActive]}>
                {s.label}
              </Text>
              {active === s.id && <View style={styles.subNavIndicator} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <SubScreenContent screen={active} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  subNav: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subNavContent: { paddingHorizontal: Spacing.sm, gap: 0, alignItems: 'stretch' },
  subNavItem: {
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    alignItems: 'center', position: 'relative',
  },
  subNavLabel: {
    color: Colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5,
  },
  subNavLabelActive: { color: Colors.text },
  subNavIndicator: {
    position: 'absolute', bottom: 0, left: Spacing.md, right: Spacing.md,
    height: 2, backgroundColor: Colors.primary, borderRadius: 1,
  },
});
