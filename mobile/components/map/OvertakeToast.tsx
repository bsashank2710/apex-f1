import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '../../constants/theme';
import type { OvertakeEvent } from '../../lib/f1RaceVisualization';

export function OvertakeToast({ event, onDone }: { event: OvertakeEvent | null; onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    if (!event) return;
    opacity.setValue(0);
    translateY.setValue(-12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 320, useNativeDriver: true }).start(() => onDone());
    }, 3800);
    return () => clearTimeout(t);
  }, [event, onDone, opacity, translateY]);

  if (!event) return null;

  return (
    <Animated.View
      style={[styles.wrap, { opacity, transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <View style={styles.glow} />
      <Text style={styles.txt}>
        <Text style={styles.passer}>{event.passer_code}</Text>
        <Text style={styles.mid}>  overtakes  </Text>
        <Text style={styles.passed}>{event.passed_code}</Text>
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: '#0a1628',
    borderWidth: 1,
    borderColor: '#00f5ff55',
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00f5ff',
    opacity: 0.06,
  },
  txt: { textAlign: 'center', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  passer: { color: '#00f5ff' },
  mid: { color: Colors.textMuted, fontWeight: '600' },
  passed: { color: Colors.text },
});
