/**
 * Decode Ergast-only synthetic session keys (negative integers) from the API.
 * Must match backend/routers/live.py _encode_synthetic_session_key.
 */

const _SYNTH_SK_YEAR_MUL = 1_000_000;
const _SYNTH_SK_ROUND_MUL = 10_000;

export type SyntheticSessionKind = 'race' | 'qualifying' | 'sprint';

const KIND_MAP: Record<number, SyntheticSessionKind> = {
  1: 'race',
  2: 'qualifying',
  3: 'sprint',
};

/** Negative meeting_key from Ergast calendar rows — matches live.py _decode_synthetic_meeting_key. */
const _SYNTHETIC_MK_ROUND_MOD = 1000;

export function decodeSyntheticMeetingKey(meetingKey: number): {
  year: number;
  round: number;
} | null {
  if (meetingKey >= 0) return null;
  const x = -meetingKey;
  const y = Math.floor(x / _SYNTHETIC_MK_ROUND_MOD);
  const rnd = x % _SYNTHETIC_MK_ROUND_MOD;
  if (y < 1950 || rnd < 1) return null;
  return { year: y, round: rnd };
}

export function decodeSyntheticSessionKey(sk: number): {
  year: number;
  round: number;
  kind: SyntheticSessionKind;
} | null {
  if (sk >= 0) return null;
  const x = -sk;
  const year = Math.floor(x / _SYNTH_SK_YEAR_MUL);
  const rem = x % _SYNTH_SK_YEAR_MUL;
  const round = Math.floor(rem / _SYNTH_SK_ROUND_MUL);
  const kindNum = rem % _SYNTH_SK_ROUND_MUL;
  const kind = KIND_MAP[kindNum];
  if (!kind || year < 1950 || round < 1) return null;
  return { year, round, kind };
}
