/**
 * Default public API (Google Cloud Run). Used when EXPO_PUBLIC_API_URL is unset.
 * Local backend: set EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 in mobile/.env, or run `npm run dev:web:local`.
 */
export const DEFAULT_API_BASE_URL =
  'https://apex-f1-api-dlum7qomda-uc.a.run.app';

/** Finished-races mode: no OpenF1 “latest”, no live WebSocket; FastF1 + Ergast only. */
export function isHistoricalOnly(): boolean {
  const v = process.env.EXPO_PUBLIC_HISTORICAL_ONLY;
  if (v === 'false' || v === '0') return false;
  return true;
}

/** Skip intro when EXPO_PUBLIC_SKIP_INTRO=true (dev). Default: show lights + sound (native + web). */
export function skipIntro(): boolean {
  const v = process.env.EXPO_PUBLIC_SKIP_INTRO;
  return v === 'true' || v === '1';
}
