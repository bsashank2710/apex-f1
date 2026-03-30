/**
 * Resolve EXPO_PUBLIC_ANTHROPIC_API_KEY for API headers and direct Claude calls.
 *
 * IMPORTANT: Use a literal `process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY` expression here.
 * babel-preset-expo only rewrites that shape into Expo’s injected env — not
 * `import { env } from 'expo/virtual/env'` property reads (those stay empty on web).
 */

import Constants from 'expo-constants';

const LS_KEY = 'APEX_ANTHROPIC_KEY';

function tryExtra(extra: Record<string, unknown> | undefined | null): string {
  const v = extra?.anthropicApiKey;
  if (v == null) return '';
  return String(v).trim();
}

/** Dev escape hatch if .env still doesn’t reach the web bundle: localStorage.setItem('APEX_ANTHROPIC_KEY', 'sk-ant-...') */
function keyFromDevLocalStorage(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage?.getItem(LS_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function getAnthropicAppKey(): string {
  const fromBabel = String(process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '').trim();
  if (fromBabel) return fromBabel;

  const exCfg = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const a = tryExtra(exCfg);
  if (a) return a;

  const man = Constants.manifest as Record<string, unknown> | null | undefined;
  const b = tryExtra(man?.extra as Record<string, unknown> | undefined);
  if (b) return b;

  const nested = (man as { expo?: { extra?: Record<string, unknown> } } | undefined)?.expo?.extra;
  const c = tryExtra(nested);
  if (c) return c;

  const ls = keyFromDevLocalStorage();
  if (ls) return ls;

  return '';
}
