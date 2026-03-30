import type { ExpoConfig } from 'expo/config';

/** Linked EAS project (@sashank_b/apex-f1). Override with env EAS_PROJECT_ID for forks. */
const EAS_PROJECT_ID =
  process.env.EAS_PROJECT_ID ?? 'af132e55-851b-49b7-950c-c8c74f7c16da';

/**
 * Set EXPO_PUBLIC_API_URL in Expo → Environment variables (preview / production)
 * to your deployed API — not localhost.
 */
export default (): ExpoConfig => ({
  owner: 'sashank_b',
  name: 'APEX F1',
  slug: 'apex-f1',
  version: '1.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#06060E',
  },
  scheme: 'apex-f1',
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.apex.f1',
    buildNumber: '1',
  },
  android: {
    package: 'com.apex.f1',
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: '#080808',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    /** Production static export: `npm run build:web` → `dist/` */
    output: 'static',
  },
  plugins: [
    'expo-font',
    'expo-router',
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#E8000D',
        sounds: [],
        androidMode: 'default',
        androidCollapsedTitle: 'APEX F1 Alerts',
      },
    ],
    'expo-updates',
  ],
  extra: {
    eas: {
      projectId: EAS_PROJECT_ID,
    },
    /**
     * Do NOT put `EXPO_PUBLIC_ANTHROPIC_API_KEY` here — EAS local/cloud logs resolve `app.config`
     * and would leak it. Use `mobile/.env`, EAS env vars, or `getAnthropicAppKey()` (babel-inlined env).
     */
  },
});
