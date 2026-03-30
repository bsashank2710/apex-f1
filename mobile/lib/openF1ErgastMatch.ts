/**
 * Match OpenF1 session / map focus location fields to an Ergast schedule row.
 */

import type { ErgastRace } from './api';

export function openF1LocationMatchesErgastRace(
  sessionLocation: string | undefined,
  sessionCountry: string | undefined,
  ergastRace: ErgastRace | undefined,
): boolean {
  if (!ergastRace) return false;
  const sl = (sessionLocation ?? '').trim().toLowerCase();
  const sc = (sessionCountry ?? '').trim().toLowerCase();
  if (!sl && !sc) return false;
  const loc = (ergastRace.Circuit?.Location?.locality ?? '').toLowerCase();
  const country = (ergastRace.Circuit?.Location?.country ?? '').toLowerCase();
  const rn = (ergastRace.raceName ?? '').toLowerCase();
  if (sl && (loc.includes(sl) || sl.includes(loc) || rn.includes(sl))) return true;
  if (sc && (country.includes(sc) || sc.includes(country))) return true;
  return false;
}

/** Pick Ergast round for the weekend OpenF1 is pointing at (map_session / session row). */
export function ergastRoundForOpenF1Focus(
  schedule: ErgastRace[] | undefined,
  yearStr: string,
  location: string | undefined,
  countryName: string | undefined,
): { year: string; round: string } | null {
  if (!schedule?.length) return null;
  for (const r of schedule) {
    if (openF1LocationMatchesErgastRace(location, countryName, r)) {
      return { year: yearStr, round: String(r.round) };
    }
  }
  return null;
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Race Hub analysis round when OpenF1 map focus exists: if the session just ended (`recent`)
 * but the calendar has moved on, follow the next round so we do not show stale data forever.
 *
 * When map focus is **empty** (no OpenF1 credentials / API down), prefer the **last completed**
 * race on the calendar — not the next upcoming one, which has no Ergast results yet.
 */
export function pickRaceHubAnalysisTarget(
  mapFocus:
    | {
        location?: string;
        circuit_short_name?: string;
        country_name?: string;
        map_phase?: string;
        year?: number;
      }
    | null
    | undefined,
  schedule: ErgastRace[] | undefined,
  scheduleYear: string,
): { year: string; round: string } {
  const today = todayIsoUtc();
  const sorted = schedule?.length
    ? [...schedule].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const loc = mapFocus?.location ?? mapFocus?.circuit_short_name;
  const country = mapFocus?.country_name;
  const hasFocus = !!(loc || country);

  const fallbackLast = { year: 'current', round: 'last' };

  if (!sorted.length) {
    if (!hasFocus) return fallbackLast;
    return ergastRoundForOpenF1Focus(schedule, scheduleYear, loc, country) ?? fallbackLast;
  }

  if (!hasFocus) {
    const past = sorted.filter(r => r.date <= today);
    const lastPast = past[past.length - 1];
    if (lastPast) return { year: String(lastPast.season), round: String(lastPast.round) };
    return fallbackLast;
  }

  const hit = ergastRoundForOpenF1Focus(schedule, scheduleYear, loc, country);
  if (!hit) return fallbackLast;

  const phase = mapFocus?.map_phase;
  const matched = sorted.find(r => String(r.round) === hit.round);
  const raceAlreadyRun = matched != null && matched.date <= today;

  if (phase === 'recent' && raceAlreadyRun) {
    const next = sorted.find(r => r.date >= today);
    if (next) return { year: String(next.season), round: String(next.round) };
  }

  return { year: hit.year, round: hit.round };
}
