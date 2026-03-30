import { View, StyleSheet, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useState } from 'react';
import AIPredictions from '../../screens/AIPredictions';
import StrategyVault from '../../screens/StrategyVault';
import Weather from '../../screens/Weather';
import { Colors, Spacing } from '../../constants/theme';

type SubScreen = 'strategy' | 'ai' | 'weather';

const TABS: Array<{ id: SubScreen; label: string }> = [
  { id: 'strategy', label: 'STRATEGY' },
  { id: 'ai', label: 'AI INTEL' },
  { id: 'weather', label: 'WEATHER' },
];

export default function StrategyTab() {
  const [active, setActive] = useState<SubScreen>('strategy');

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={styles.tab}
            onPress={() => setActive(t.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabLabel, active === t.id && styles.tabLabelActive]}>
              {t.label}
            </Text>
            {active === t.id && <View style={styles.indicator} />}
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {active === 'strategy' && <StrategyVault />}
        {active === 'ai' && <AIPredictions />}
        {active === 'weather' && <Weather />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1, paddingVertical: 11, alignItems: 'center', position: 'relative',
  },
  indicator: {
    position: 'absolute', bottom: 0, left: Spacing.md, right: Spacing.md,
    height: 2, backgroundColor: Colors.primary, borderRadius: 1,
  },
  tabLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  tabLabelActive: { color: Colors.text },
});
