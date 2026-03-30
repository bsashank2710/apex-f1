/**
 * Weather — live track weather conditions and historical weather trend.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { live } from '../lib/api';
import type { Weather as WeatherData } from '../lib/api';
import { Colors, Spacing, FontSize, Radius } from '../constants/theme';

const CHART_W = 300;
const CHART_H = 80;

function TempChart({ data, field, color, label }: {
  data: WeatherData[];
  field: keyof WeatherData;
  color: string;
  label: string;
}) {
  const values = data.map((d) => (d[field] as number) ?? 0);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * CHART_W;
      const y = CHART_H - ((v - min) / range) * CHART_H;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <View style={styles.chartContainer}>
      <Text style={[styles.chartLabel, { color }]}>{label}</Text>
      <Svg width={CHART_W} height={CHART_H + 16}>
        <Polyline points={points} stroke={color} strokeWidth={2} fill="none" />
        <SvgText x={0} y={CHART_H + 12} fontSize={9} fill={Colors.textMuted}>{min.toFixed(1)}°</SvgText>
        <SvgText x={CHART_W - 20} y={CHART_H + 12} fontSize={9} fill={Colors.textMuted}>{max.toFixed(1)}°</SvgText>
      </Svg>
    </View>
  );
}

function StatCard({ label, value, unit, highlight }: {
  label: string;
  value?: number | null;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && styles.statHighlight]}>
        {value != null ? value.toFixed(1) : '—'}
        <Text style={styles.statUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

export default function WeatherScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['weather'],
    queryFn: () => live.weather(),
    refetchInterval: 30000,
  });

  const latest = data?.[data.length - 1];
  const isRaining = (latest?.rainfall ?? 0) > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
      }
    >
      <Text style={styles.title}>TRACK CONDITIONS</Text>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : !latest ? (
        <Text style={styles.noData}>No weather data available for this session.</Text>
      ) : (
        <>
          {/* Rain alert */}
          {isRaining && (
            <View style={styles.rainAlert}>
              <Text style={styles.rainIcon}>🌧</Text>
              <Text style={styles.rainText}>RAINFALL DETECTED</Text>
            </View>
          )}

          {/* Current conditions grid */}
          <View style={styles.grid}>
            <StatCard label="AIR TEMP" value={latest.air_temperature} unit="°C" />
            <StatCard label="TRACK TEMP" value={latest.track_temperature} unit="°C" highlight />
            <StatCard label="HUMIDITY" value={latest.humidity} unit="%" />
            <StatCard label="PRESSURE" value={latest.pressure} unit="mbar" />
            <StatCard label="WIND SPEED" value={latest.wind_speed} unit="m/s" />
            <StatCard label="WIND DIR" value={latest.wind_direction} unit="°" />
          </View>

          {/* Tyre recommendation based on conditions */}
          <View style={styles.tyreRec}>
            <Text style={styles.tyreRecTitle}>RECOMMENDED COMPOUND</Text>
            {isRaining ? (
              (latest.rainfall ?? 0) > 1 ? (
                <View style={[styles.compoundBadge, { borderColor: Colors.wet }]}>
                  <Text style={[styles.compoundText, { color: Colors.wet }]}>WET</Text>
                </View>
              ) : (
                <View style={[styles.compoundBadge, { borderColor: Colors.intermediate }]}>
                  <Text style={[styles.compoundText, { color: Colors.intermediate }]}>INTERMEDIATE</Text>
                </View>
              )
            ) : (latest.track_temperature ?? 0) > 40 ? (
              <View style={[styles.compoundBadge, { borderColor: Colors.hard }]}>
                <Text style={[styles.compoundText, { color: Colors.hard }]}>HARD</Text>
              </View>
            ) : (latest.track_temperature ?? 0) > 30 ? (
              <View style={[styles.compoundBadge, { borderColor: Colors.medium }]}>
                <Text style={[styles.compoundText, { color: Colors.medium }]}>MEDIUM</Text>
              </View>
            ) : (
              <View style={[styles.compoundBadge, { borderColor: Colors.soft }]}>
                <Text style={[styles.compoundText, { color: Colors.soft }]}>SOFT</Text>
              </View>
            )}
          </View>

          {/* Trend charts */}
          {(data?.length ?? 0) > 1 && (
            <View style={styles.charts}>
              <Text style={styles.chartsTitle}>SESSION TREND</Text>
              <TempChart
                data={data!}
                field="air_temperature"
                color={Colors.primary}
                label="Air Temperature (°C)"
              />
              <TempChart
                data={data!}
                field="track_temperature"
                color={Colors.safetyCarYellow}
                label="Track Temperature (°C)"
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  title: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900', letterSpacing: 2, marginBottom: Spacing.md },
  noData: { color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xl },
  rainAlert: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.wet + '22', borderWidth: 1, borderColor: Colors.wet,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  rainIcon: { fontSize: 24 },
  rainText: { color: Colors.wet, fontSize: FontSize.md, fontWeight: '700', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  statCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md,
    width: '47%', alignItems: 'flex-start',
  },
  statLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  statValue: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '900' },
  statHighlight: { color: Colors.primary },
  statUnit: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: '400' },
  tyreRec: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md,
    alignItems: 'flex-start',
  },
  tyreRecTitle: { color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: Spacing.sm },
  compoundBadge: { borderWidth: 2, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  compoundText: { fontSize: FontSize.lg, fontWeight: '900', letterSpacing: 2 },
  charts: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md,
  },
  chartsTitle: { color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: Spacing.sm },
  chartContainer: { marginBottom: Spacing.md },
  chartLabel: { fontSize: FontSize.xs, fontWeight: '600', marginBottom: 4 },
});
