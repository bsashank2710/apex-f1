/**
 * Skeleton loading components — animated shimmer placeholders.
 * Uses React Native's Animated API (no extra deps).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius } from '../constants/theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = Radius.sm,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: Colors.surfaceHigh,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** A skeleton row that mimics a driver leaderboard entry */
export function DriverRowSkeleton() {
  return (
    <View style={styles.driverRow}>
      <Skeleton width={36} height={56} borderRadius={0} />
      <View style={styles.driverInfo}>
        <Skeleton width={48} height={14} style={{ marginBottom: 6 }} />
        <Skeleton width={80} height={10} />
      </View>
      <Skeleton width={60} height={14} />
    </View>
  );
}

/** Skeleton for a full leaderboard (20 rows) */
export function LeaderboardSkeleton({ rows = 20 }: { rows?: number }) {
  return (
    <View style={{ gap: 2 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <DriverRowSkeleton key={i} />
      ))}
    </View>
  );
}

/** Skeleton for a card panel */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <Skeleton width={120} height={12} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '60%' : '100%'}
          height={14}
          style={{ marginBottom: 8 }}
        />
      ))}
    </View>
  );
}

/** Full-screen skeleton for chart/telemetry screens */
export function ChartSkeleton() {
  return (
    <View style={styles.chartContainer}>
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={100} borderRadius={Radius.md} style={{ marginBottom: 16 }} />
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={100} borderRadius={Radius.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    height: 56,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    gap: 8,
  },
  driverInfo: { flex: 1, paddingHorizontal: 8 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chartContainer: {
    padding: 16,
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
