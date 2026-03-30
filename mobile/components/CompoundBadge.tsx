/**
 * CompoundBadge — F1 tyre compound icon with official compound colors.
 * Available sizes: sm (18px), md (24px), lg (32px).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/theme';

export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | string;

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: Colors.soft,
  MEDIUM: Colors.medium,
  HARD: Colors.hard,
  INTERMEDIATE: Colors.intermediate,
  WET: Colors.wet,
};

const COMPOUND_LETTER: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

// Background fill for each compound (subtle)
const COMPOUND_BG: Record<string, string> = {
  SOFT: '#E8002D18',
  MEDIUM: '#FFD60018',
  HARD: '#F0F0FF18',
  INTERMEDIATE: '#00A55018',
  WET: '#0072CE18',
};

const SIZES = {
  sm: { outer: 18, fontSize: 9, borderWidth: 1.5 },
  md: { outer: 24, fontSize: 11, borderWidth: 2 },
  lg: { outer: 32, fontSize: 14, borderWidth: 2.5 },
  xl: { outer: 40, fontSize: 18, borderWidth: 3 },
};

interface Props {
  compound?: string;
  size?: keyof typeof SIZES;
  showLabel?: boolean;
}

export function CompoundBadge({ compound, size = 'md', showLabel = false }: Props) {
  const key = compound?.toUpperCase() ?? '';
  const color = COMPOUND_COLORS[key] ?? Colors.textMuted;
  const letter = COMPOUND_LETTER[key] ?? (compound?.[0] ?? '?');
  const bg = COMPOUND_BG[key] ?? Colors.surfaceHigh;
  const { outer, fontSize, borderWidth } = SIZES[size];

  return (
    <View style={styles.wrapper}>
      <View style={[
        styles.badge,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderColor: color,
          borderWidth,
          backgroundColor: bg,
        },
      ]}>
        <Text style={[styles.letter, { color, fontSize, fontWeight: '900' }]}>
          {letter}
        </Text>
      </View>
      {showLabel && compound && (
        <Text style={[styles.label, { color }]}>
          {compound.charAt(0) + compound.slice(1).toLowerCase()}
        </Text>
      )}
    </View>
  );
}

/** Horizontal row of compounds for a driver's strategy. */
export function StrategyBadges({
  compounds,
  lapCounts,
}: {
  compounds: string[];
  lapCounts?: number[];
}) {
  return (
    <View style={styles.strategyRow}>
      {compounds.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text style={styles.arrow}>→</Text>}
          <View style={styles.strategyItem}>
            <CompoundBadge compound={c} size="md" />
            {lapCounts?.[i] != null && (
              <Text style={styles.lapCount}>{lapCounts[i]}L</Text>
            )}
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: 2 },
  badge: { justifyContent: 'center', alignItems: 'center' },
  letter: { lineHeight: undefined },
  label: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  strategyRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  arrow: { color: Colors.textMuted, fontSize: 10 },
  strategyItem: { alignItems: 'center', gap: 2 },
  lapCount: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
});
