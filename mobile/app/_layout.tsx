import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Colors } from '../constants/theme';
import { ErrorBoundary } from '../components/ErrorBoundary';
import IntroScreen from '../components/IntroScreen';
import { requestPermissions, addNotificationResponseListener, removeSubscription } from '../lib/notifications';
import { useRaceWebSocket } from '../lib/websocket';
import { HistoricalDefaultSessionLoader } from '../components/HistoricalDefaultSessionLoader';
import { isHistoricalOnly, skipIntro } from '../lib/config';
import { HistoricalDataPrefetch } from '../components/HistoricalDataPrefetch';
import * as Notifications from 'expo-notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60_000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

function AppBootstrap({ children }: { children: React.ReactNode }) {
  useRaceWebSocket(!isHistoricalOnly());
  const notifSubRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    requestPermissions();
    notifSubRef.current = addNotificationResponseListener((response) => {
      console.log('Notification tapped:', response.notification.request.content.data);
    });
    return () => {
      if (notifSubRef.current) removeSubscription(notifSubRef.current);
    };
  }, []);

  return (
    <>
      <HistoricalDefaultSessionLoader />
      <HistoricalDataPrefetch />
      {children}
    </>
  );
}

export default function RootLayout() {
  /**
   * Intro (lights + tap + sound) on every cold start for native and web, unless
   * EXPO_PUBLIC_SKIP_INTRO is set. Web needs the tap so audio isn’t blocked by autoplay policy.
   */
  const [introComplete, setIntroComplete] = useState(() => skipIntro());

  // Prevent accidental text selection highlights on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = [
      '*, *::before, *::after { user-select: none; -webkit-user-select: none; }',
      'input, textarea, [contenteditable] { user-select: text; -webkit-user-select: text; }',
      '::selection { background: transparent; }',
    ].join('\n');
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" backgroundColor={introComplete ? Colors.background : '#000000'} />
        <AppBootstrap>
          <View style={styles.root}>
            {/*
             * Keep the navigator at full opacity. Hiding it with opacity:0 during the intro
             * breaks React Native Web (blank UI after dismiss). Cover it with the intro layer instead.
             */}
            <View style={styles.appLayer}>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: Colors.background },
                  headerTintColor: Colors.text,
                  headerTitleStyle: { fontWeight: '700' },
                  contentStyle: { backgroundColor: Colors.background },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              </Stack>
            </View>

            {!introComplete && (
              <View style={styles.introLayer}>
                <IntroScreen onComplete={() => setIntroComplete(true)} />
              </View>
            )}
          </View>
        </AppBootstrap>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  appLayer: {
    flex: 1,
  },
  introLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
});
