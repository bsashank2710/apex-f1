/**
 * Human-readable OpenF1 session labels (qualifying = three knockout segments).
 */

import type { RaceControlMsg } from './api';

/** Expand generic "Qualifying" into the real F1 format. */
export function expandQualifyingSessionName(sessionName?: string | null): string {
  const n = (sessionName ?? '').trim();
  if (!n) return '';
  if (n === 'Qualifying') return 'Qualifying · Q1 · Q2 · Q3';
  if (n === 'Sprint Qualifying') return 'Sprint Qualifying · SQ1 · SQ2 · SQ3';
  return n;
}

export function isQualifyingSessionName(sessionName?: string | null): boolean {
  const n = (sessionName ?? '').trim();
  return n === 'Qualifying' || n === 'Sprint Qualifying';
}

/**
 * Whether the map may load Ergast race lap evolution + FastF1 circuit for LAP REPLAY.
 * That feed is always the **race or sprint** for this round (not Q1–Q3 laps), but we allow
 * it on Qualifying / Practice tabs too so you can scrub the same circuit anytime.
 */
export function sessionSupportsErgastLapReplay(_sessionName?: string | null): boolean {
  return true;
}

/**
 * Best-effort current segment from recent race control (live quali only).
 */
export function inferQualifyingSegment(messages: RaceControlMsg[] | undefined): 1 | 2 | 3 | null {
  if (!messages?.length) return null;
  const tail = messages.slice(-50);
  const joined = tail
    .map(m => (m.message ?? '').toUpperCase())
    .join(' | ');

  const has = (re: RegExp) => re.test(joined);

  // FIA wording varies: "QUALIFYING SESSION 2", "Q2 WILL BEGIN", etc.
  if (
    has(/\bQUALIFYING SESSION 3\b/)
    || has(/\bSESSION 3\b.*\bQUALIFY\b/)
    || has(/\bQ3\b.*\b(START|BEGIN|UNDERWAY|GREEN|OPEN)\b/)
  ) {
    return 3;
  }
  if (
    has(/\bQUALIFYING SESSION 2\b/)
    || has(/\bSESSION 2\b.*\bQUALIFY\b/)
    || has(/\bQ2\b.*\b(START|BEGIN|UNDERWAY|GREEN|OPEN)\b/)
  ) {
    return 2;
  }
  if (
    has(/\bQUALIFYING SESSION 1\b/)
    || has(/\bSESSION 1\b.*\bQUALIFY\b/)
    || has(/\bQ1\b.*\b(START|BEGIN|UNDERWAY|GREEN|OPEN)\b/)
  ) {
    return 1;
  }
  // Fallback: last explicit segment mention
  for (let i = tail.length - 1; i >= 0; i--) {
    const t = (tail[i].message ?? '').toUpperCase();
    if (/\bQ3\b/.test(t) && !/\bQ2\b.*\bEND\b/.test(t)) return 3;
    if (/\bQ2\b/.test(t) && /\b(START|BEGIN)\b/.test(t)) return 2;
    if (/\bQ1\b/.test(t) && /\b(START|BEGIN)\b/.test(t)) return 1;
  }
  return null;
}
