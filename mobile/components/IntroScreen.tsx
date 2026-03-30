/**
 * IntroScreen — Premium F1 start lights sequence.
 * Responsive: scales lights + logo to fit narrow phones.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/theme';
import { playStartupSound } from '../lib/playStartupSound';

const HOLD_MS = 900;
const COUNTDOWN_MS = 1180;
const FADE_DELAY = 300;
const FADE_OUT_MS = 800;

function useIntroLayout() {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const pad = 12;
    const rowW = Math.max(0, width - pad * 2);
    const gap = Math.max(3, Math.min(12, Math.round(width * 0.028)));
    // 5*(bulb*2.6+4) + 4*gap = rowW  →  bulb = (rowW - 16 - 4*gap) / 13
    const bulb = Math.round(
      Math.max(20, Math.min(48, (rowW - 16 - 4 * gap) / 13)),
    );
    const corona = bulb * 2.6;
    const wrap = corona + 4;
    const logoApex = Math.min(48, Math.max(28, width * 0.11));
    const letterApex = Math.min(14, Math.max(6, logoApex * 0.26));
    const logoF1 = Math.max(12, logoApex * 0.32);
    const letterF1 = Math.min(10, Math.max(4, logoF1 * 0.55));
    const logoMarginBottom = Math.min(56, Math.max(24, height * 0.06));
    const tapMarginTop = Math.min(48, Math.max(16, height * 0.04));
    return {
      bulb,
      gap,
      wrap,
      corona,
      logoApex,
      letterApex,
      logoF1,
      letterF1,
      logoMarginBottom,
      tapMarginTop,
      pad,
    };
  }, [width, height]);
}

function Light({
  on,
  out,
  bulb,
  wrap,
}: {
  on: boolean;
  out: boolean;
  bulb: number;
  wrap: number;
}) {
  const coronaScale = useRef(new Animated.Value(0.5)).current;
  const coronaOpacity = useRef(new Animated.Value(0)).current;
  const midOpacity = useRef(new Animated.Value(0)).current;
  const bulbOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (out) {
      // Real F1: all lights snap off together — no fade, no afterglow ring (that read as flicker).
      coronaScale.stopAnimation();
      coronaOpacity.stopAnimation();
      midOpacity.stopAnimation();
      bulbOpacity.stopAnimation();
      coronaScale.setValue(0.5);
      coronaOpacity.setValue(0);
      midOpacity.setValue(0);
      bulbOpacity.setValue(0);
      return;
    }
    if (on) {
      Animated.parallel([
        Animated.spring(coronaScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 200,
          friction: 8,
        }),
        Animated.timing(coronaOpacity, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.timing(midOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(bulbOpacity, { toValue: 1, duration: 70, useNativeDriver: true }),
      ]).start();
    }
  }, [on, out]);

  const housing = bulb + 10;
  const corona = bulb * 2.6;

  return (
    <View style={{ width: wrap, height: wrap, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: corona,
            height: corona,
            borderRadius: corona / 2,
            backgroundColor: '#FF1801',
            opacity: coronaOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }),
            transform: [{ scale: coronaScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: bulb * 1.55,
            height: bulb * 1.55,
            borderRadius: bulb * 0.775,
            backgroundColor: '#FF2200',
            opacity: midOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] }),
          },
        ]}
      />
      <View
        style={{
          width: housing,
          height: housing,
          borderRadius: housing / 2,
          backgroundColor: '#141414',
          borderWidth: 2.5,
          borderColor: '#2a2a2a',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            width: bulb,
            height: bulb,
            borderRadius: bulb / 2,
            backgroundColor: '#1c0000',
          }}
        />
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: bulb,
              height: bulb,
              borderRadius: bulb / 2,
              backgroundColor: '#FF1801',
              opacity: bulbOpacity,
            },
          ]}
        />
        <View
          style={{
            position: 'absolute',
            top: bulb * 0.11,
            left: bulb * 0.16,
            width: bulb * 0.24,
            height: bulb * 0.14,
            borderRadius: bulb * 0.07,
            backgroundColor: 'rgba(255,255,255,0.28)',
            transform: [{ rotate: '-35deg' }],
          }}
        />
      </View>
    </View>
  );
}

type Phase = 'tap' | 'on' | 'counting' | 'out' | 'fade';

export default function IntroScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>('tap');
  const [lightsOn, setOn] = useState(false);
  const [lightsOut, setOut] = useState(false);
  const layout = useIntroLayout();
  const insets = useSafeAreaInsets();

  const screenOpacity = useRef(new Animated.Value(1)).current;
  const tapOpacity = useRef(new Animated.Value(1)).current;
  const tapPulse = useRef(new Animated.Value(1)).current;
  const ambient = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'tap') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tapPulse, { toValue: 0.2, duration: 900, useNativeDriver: true }),
        Animated.timing(tapPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);

  function startSequence() {
    if (phase !== 'tap') return;
    void playStartupSound();
    Animated.timing(tapOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    setOn(true);
    setPhase('on');
    Animated.timing(ambient, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      setPhase('counting');
      setTimeout(() => {
        setOut(true);
        setPhase('out');
        ambient.stopAnimation();
        ambient.setValue(0);
        setTimeout(() => {
          setPhase('fade');
          Animated.timing(screenOpacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            useNativeDriver: true,
          }).start(() => onComplete());
        }, FADE_DELAY);
      }, COUNTDOWN_MS + 60);
    }, HOLD_MS);
  }

  return (
    <Animated.View style={[s.container, { opacity: screenOpacity }]}>
      <ScrollView
        pointerEvents={phase === 'tap' ? 'none' : 'auto'}
        style={s.scroll}
        contentContainerStyle={[
          s.scrollInner,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 12,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
          <View style={s.grid} pointerEvents="none">
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={i} style={s.gridLine} />
            ))}
          </View>
          <Animated.View
            style={[
              s.ambientBloom,
              {
                opacity: ambient.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07] }),
              },
            ]}
            pointerEvents="none"
          />
          <View style={[s.logo, { marginBottom: layout.logoMarginBottom }]}>
            <Text
              style={[s.logoApex, { fontSize: layout.logoApex, letterSpacing: layout.letterApex }]}
            >
              APEX
            </Text>
            <Text
              style={[s.logoF1, { fontSize: layout.logoF1, letterSpacing: layout.letterF1 }]}
            >
              F1
            </Text>
            <View style={s.logoBar} />
          </View>
          <View style={[s.row, { gap: layout.gap }]}>
            {[0, 1, 2, 3, 4].map(i => (
              <Light key={i} on={lightsOn} out={lightsOut} bulb={layout.bulb} wrap={layout.wrap} />
            ))}
          </View>
          <Animated.View
            style={[
              s.tapWrap,
              { marginTop: layout.tapMarginTop, opacity: Animated.multiply(tapOpacity, tapPulse) },
            ]}
          >
            <Text style={s.tapText}>TAP TO BEGIN</Text>
          </Animated.View>
          <Text style={[s.tag, { marginTop: 'auto' }]}>2026 FIA FORMULA ONE WORLD CHAMPIONSHIP</Text>
      </ScrollView>
      {phase === 'tap' && (
        <Pressable
          style={s.tapOverlay}
          onPress={startSequence}
          accessibilityRole="button"
          accessibilityLabel="Tap to begin"
        />
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060606',
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  scroll: { flex: 1 },
  scrollInner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-around',
  } as any,
  gridLine: {
    width: 1,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  ambientBloom: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FF1801',
  },
  logo: { alignItems: 'center' },
  logoApex: {
    color: '#fff',
    fontWeight: '900',
  },
  logoF1: {
    color: Colors.primary,
    fontWeight: '900',
    marginTop: -8,
  },
  logoBar: {
    marginTop: 12,
    width: 44,
    height: 2,
    backgroundColor: Colors.primary,
    borderRadius: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
  },
  tapWrap: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 3,
  },
  tapText: {
    color: '#555',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 4,
  },
  tag: {
    color: 'rgba(255,255,255,0.07)',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
