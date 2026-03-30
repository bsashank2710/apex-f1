/**
 * OpenF1 session rows usually omit `status`. Live UI must infer "on track" from the
 * published session window (date_start → date_end, ISO 8601, typically UTC).
 */

function parseOpenF1Date(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** True when timing / map / telemetry for this session should be treated as live. */
export function sessionIsLive(
  s: { status?: string; date_start?: string; date_end?: string } | null | undefined,
): boolean {
  if (!s) return false;
  const st = s.status;
  if (st === 'Active' || st === 'Started') return true;
  const start = parseOpenF1Date(s.date_start);
  const end = parseOpenF1Date(s.date_end);
  if (start == null || end == null) return false;
  const now = Date.now();
  return now >= start && now <= end;
}
