"""
Live timing endpoints — proxies OpenF1 data with optional filtering.
All endpoints accept session_key (defaults to "latest").
"""

import asyncio
from collections import defaultdict

from datetime import date, datetime, timedelta
from fastapi import APIRouter, Query
from typing import Optional

from services import cache as _apex_cache
from services import ergast as _ergast
from services import openf1
from routers.telemetry import (
    _executor,
    _FASTF1_ROUND_LIVE_TTL_SEC,
    _FASTF1_FINISHED_TTL_SEC,
    _get_fastf1_round_drivers_openf1_shaped_sync,
    _get_fastf1_round_laps_openf1_shaped_sync,
    _get_fastf1_round_race_control_sync,
    _get_fastf1_round_stints_openf1_shaped_sync,
)

# How many positions to sample for the track outline (every Nth point)
_TRACK_SAMPLE_STEP = 4

# Ergast-only meeting rows use negative meeting_key = -(year * 1000 + round), 1 <= round < 1000
_SYNTHETIC_MK_ROUND_MOD = 1000


def _meetings_from_session_rows(sessions: list[dict]) -> list[dict]:
    """Build /meetings-shaped rows by grouping OpenF1 /sessions on meeting_key (chronological)."""
    by_mk: dict[int, list[dict]] = defaultdict(list)
    for s in sessions:
        mk = s.get("meeting_key")
        if mk is None:
            continue
        try:
            mki = int(mk)
        except (TypeError, ValueError):
            continue
        by_mk[mki].append(s)
    if not by_mk:
        return []

    def sess_min_start(sl: list[dict]) -> str:
        dates = [str(x.get("date_start") or "") for x in sl]
        return min(dates) if dates else ""

    ordered_mks = sorted(by_mk.keys(), key=lambda mk: sess_min_start(by_mk[mk]))
    out: list[dict] = []
    for idx, mk in enumerate(ordered_mks):
        sl = sorted(by_mk[mk], key=lambda x: str(x.get("date_start") or ""))
        first = sl[0]
        out.append(
            {
                "meeting_key": mk,
                "meeting_name": first.get("meeting_name"),
                "meeting_official_name": first.get("meeting_official_name"),
                "country_name": first.get("country_name"),
                "country_code": first.get("country_code"),
                "circuit_short_name": first.get("circuit_short_name"),
                "circuit_key": first.get("circuit_key"),
                "year": first.get("year"),
                "date_start": first.get("date_start"),
                "location": first.get("location"),
                # Chronological round index for the season (FastF1/OpenF1 align with calendar order).
                "ergast_round": idx + 1,
            }
        )
    return out


async def _meetings_from_ergast_schedule(year: int) -> list[dict]:
    """Calendar rounds without OpenF1 — synthetic meeting_key encodes Ergast round for later resolution."""
    races = await _ergast.get_schedule(year)
    if not races:
        return []

    def rnd_key(r: dict) -> int:
        try:
            return int(r.get("round", 0))
        except (TypeError, ValueError):
            return 0

    out: list[dict] = []
    for r in sorted(races, key=rnd_key):
        rnd = rnd_key(r)
        if rnd < 1 or rnd >= _SYNTHETIC_MK_ROUND_MOD:
            continue
        circuit = r.get("Circuit") or {}
        loc = circuit.get("Location") or {}
        mk = -(year * _SYNTHETIC_MK_ROUND_MOD + rnd)
        out.append(
            {
                "meeting_key": mk,
                "meeting_name": r.get("raceName"),
                "country_name": loc.get("country"),
                "circuit_short_name": circuit.get("circuitName") or circuit.get("circuitId"),
                "year": year,
                "date_start": r.get("date"),
                "location": loc.get("locality"),
                "ergast_round": rnd,
            }
        )
    return out


def _decode_synthetic_meeting_key(meeting_key: int) -> tuple[int, int] | None:
    if meeting_key >= 0:
        return None
    x = -meeting_key
    y = x // _SYNTHETIC_MK_ROUND_MOD
    rnd = x % _SYNTHETIC_MK_ROUND_MOD
    if y < 1950 or rnd < 1:
        return None
    return y, rnd


async def _openf1_meeting_key_for_ergast_round(year: int, ergast_round: int) -> int | None:
    sess = await openf1.get_sessions(year=year)
    meetings = _meetings_from_session_rows(sess)
    if ergast_round < 1 or ergast_round > len(meetings):
        return None
    mk = meetings[ergast_round - 1].get("meeting_key")
    try:
        return int(mk) if mk is not None else None
    except (TypeError, ValueError):
        return None


# ── Ergast-only “synthetic” sessions (negative session_key) when OpenF1 has no data ──
_SYNTH_SK_YEAR_MUL = 1_000_000
_SYNTH_SK_ROUND_MUL = 10_000
_KIND_RACE = 1
_KIND_QUALIFYING = 2
_KIND_SPRINT = 3


def _encode_synthetic_session_key(year: int, rnd: int, kind: int) -> int:
    return -(year * _SYNTH_SK_YEAR_MUL + rnd * _SYNTH_SK_ROUND_MUL + kind)


def _decode_synthetic_session_key(sk: int) -> tuple[int, int, int] | None:
    if sk >= 0:
        return None
    x = -sk
    y = x // _SYNTH_SK_YEAR_MUL
    rem = x % _SYNTH_SK_YEAR_MUL
    rnd = rem // _SYNTH_SK_ROUND_MUL
    kind = rem % _SYNTH_SK_ROUND_MUL
    if y < 1950 or rnd < 1 or kind not in (_KIND_RACE, _KIND_QUALIFYING, _KIND_SPRINT):
        return None
    return y, rnd, kind


def _synthetic_meeting_key_from_yr_rnd(year: int, rnd: int) -> int:
    return -(year * _SYNTHETIC_MK_ROUND_MOD + rnd)


def _kind_session_name(kind: int) -> str:
    return {_KIND_RACE: "Race", _KIND_QUALIFYING: "Qualifying", _KIND_SPRINT: "Sprint"}.get(
        kind, "Session"
    )


async def _synthetic_sessions_for_ergast_weekend(year: int, rnd: int) -> list[dict]:
    races = await _ergast.get_schedule(year)
    race_row: dict | None = None
    for r in races:
        try:
            if int(r.get("round", 0)) == rnd:
                race_row = r
                break
        except (TypeError, ValueError):
            continue
    mk = _synthetic_meeting_key_from_yr_rnd(year, rnd)
    circuit = (race_row or {}).get("Circuit") or {}
    loc = circuit.get("Location") or {}
    date_race = (race_row or {}).get("date")
    qual = (race_row or {}).get("Qualifying") if race_row else None
    qdate = qual.get("date") if isinstance(qual, dict) else None
    base = {
        "meeting_key": mk,
        "year": year,
        "circuit_short_name": circuit.get("circuitName") or circuit.get("circuitId"),
        "country_name": loc.get("country"),
        "location": loc.get("locality"),
        "meeting_name": (race_row or {}).get("raceName"),
    }
    out: list[dict] = [
        {
            **base,
            "session_key": _encode_synthetic_session_key(year, rnd, _KIND_QUALIFYING),
            "session_name": "Qualifying",
            "date_start": qdate or date_race,
        }
    ]
    sprint = (race_row or {}).get("Sprint") if race_row else None
    if isinstance(sprint, dict) and sprint.get("date"):
        out.append(
            {
                **base,
                "session_key": _encode_synthetic_session_key(year, rnd, _KIND_SPRINT),
                "session_name": "Sprint",
                "date_start": sprint.get("date"),
            }
        )
    out.append(
        {
            **base,
            "session_key": _encode_synthetic_session_key(year, rnd, _KIND_RACE),
            "session_name": "Race",
            "date_start": date_race,
        }
    )
    return out


def _ergast_lap_time_to_seconds(t: str) -> float | None:
    t = (t or "").strip()
    if not t:
        return None
    if ":" in t:
        parts = t.split(":")
        try:
            if len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except ValueError:
            return None
    try:
        return float(t.replace(",", "."))
    except ValueError:
        return None


async def _fetch_all_ergast_race_lap_records(year: int, rnd: int) -> list[tuple[int, str, float]]:
    """(lap_number, driver_id, lap_time_seconds)."""
    PAGE_SIZE = 100
    first = await _ergast._get(f"/{year}/{rnd}/laps", {"limit": PAGE_SIZE, "offset": 0})
    total = int(_ergast._mr(first).get("total", 0))
    pages: list[dict] = [first]
    for off in range(PAGE_SIZE, total, PAGE_SIZE):
        pages.append(await _ergast._get(f"/{year}/{rnd}/laps", {"limit": PAGE_SIZE, "offset": off}))

    flat: list[tuple[int, str, float]] = []
    seen: set[tuple[int, str]] = set()
    for data in pages:
        er = _ergast._mr(data).get("RaceTable", {}).get("Races", [])
        if not er:
            continue
        for lap_entry in er[0].get("Laps", []) or []:
            lap_num = int(lap_entry.get("number", 0) or 0)
            for timing in lap_entry.get("Timings", []) or []:
                did = timing.get("driverId", "")
                key = (lap_num, did)
                if not did or key in seen:
                    continue
                seen.add(key)
                ts = _ergast_lap_time_to_seconds(str(timing.get("time", "")))
                if ts is None:
                    continue
                flat.append((lap_num, did, ts))
    return flat


async def _ergast_driver_id_to_number(year: int, rnd: int) -> dict[str, int]:
    results = await _ergast.get_race_results(year, rnd)
    out: dict[str, int] = {}
    for r in results:
        d = r.get("Driver") or {}
        did = d.get("driverId", "")
        num = r.get("number")
        if did and num is not None and str(num).strip().isdigit():
            out[did] = int(num)
    if not out:
        for d in await _ergast.get_drivers(year):
            did = d.get("driverId", "")
            pn = d.get("permanentNumber")
            if did and pn is not None and str(pn).strip().isdigit():
                out[did] = int(pn)
    return out


async def _ergast_laps_openf1_shaped(year: int, rnd: int) -> list[dict]:
    dmap = await _ergast_driver_id_to_number(year, rnd)
    raw = await _fetch_all_ergast_race_lap_records(year, rnd)
    out: list[dict] = []
    for lap_num, did, ts in raw:
        dn = dmap.get(did)
        if dn is None:
            continue
        out.append(
            {
                "driver_number": dn,
                "lap_number": lap_num,
                "lap_duration": ts,
                "duration_sector_1": None,
                "duration_sector_2": None,
                "duration_sector_3": None,
                "is_pit_out_lap": False,
            }
        )
    return out


async def _ergast_stints_from_pit_stops(year: int, rnd: int) -> list[dict]:
    """Pit-stop-derived stints; compound is unknown (Ergast has no tyre data)."""
    dmap = await _ergast_driver_id_to_number(year, rnd)
    pits_raw = await _ergast.get_pit_stops(year, rnd)
    by_d: dict[str, list[int]] = defaultdict(list)
    for p in pits_raw:
        did = p.get("driverId", "")
        lap = p.get("lap")
        if not did or lap is None:
            continue
        try:
            by_d[did].append(int(lap))
        except (TypeError, ValueError):
            continue
    for did in by_d:
        by_d[did] = sorted(set(by_d[did]))

    max_lap_by_d: dict[str, int] = {}
    for lap_num, did, _ in await _fetch_all_ergast_race_lap_records(year, rnd):
        max_lap_by_d[did] = max(max_lap_by_d.get(did, 0), lap_num)

    stints: list[dict] = []
    for did, pit_laps in by_d.items():
        dn = dmap.get(did)
        if dn is None:
            continue
        max_lap = max_lap_by_d.get(did) or (pit_laps[-1] if pit_laps else 1)
        start_lap = 1
        for stint_i, pit_lap in enumerate(pit_laps):
            end_lap = pit_lap - 1
            if end_lap >= start_lap:
                stints.append(
                    {
                        "driver_number": dn,
                        "stint_number": stint_i + 1,
                        "lap_start": start_lap,
                        "lap_end": end_lap,
                        "compound": "UNKNOWN",
                    }
                )
            start_lap = pit_lap
        if start_lap <= max_lap:
            stints.append(
                {
                    "driver_number": dn,
                    "stint_number": len(pit_laps) + 1,
                    "lap_start": start_lap,
                    "lap_end": max_lap,
                    "compound": "UNKNOWN",
                }
            )

    for did, mx in max_lap_by_d.items():
        dn = dmap.get(did)
        if dn is None or did in by_d:
            continue
        stints.append(
            {
                "driver_number": dn,
                "stint_number": 1,
                "lap_start": 1,
                "lap_end": mx,
                "compound": "UNKNOWN",
            }
        )
    return stints


async def _synthetic_ergast_drivers(year: int, rnd: int, kind: int) -> list[dict]:
    if kind == _KIND_QUALIFYING:
        rows = await _ergast.get_qualifying_results(year, rnd)
        out: list[dict] = []
        for r in rows:
            num = r.get("number")
            d = r.get("Driver") or {}
            c = r.get("Constructor") or {}
            if num is None or not str(num).strip().isdigit():
                continue
            code = d.get("code") or ""
            out.append(
                {
                    "driver_number": int(num),
                    "full_name": f'{d.get("givenName", "")} {d.get("familyName", "")}'.strip(),
                    "name_acronym": (code or "")[:3] or None,
                    "team_name": c.get("name"),
                    "team_colour": None,
                }
            )
        return out

    results = await _ergast.get_race_results(year, rnd)
    if not results and kind == _KIND_SPRINT:
        results = await _ergast.get_sprint_results(year, rnd)
    out = []
    for r in results:
        num = r.get("number")
        d = r.get("Driver") or {}
        c = r.get("Constructor") or {}
        if num is None or not str(num).strip().isdigit():
            continue
        code = d.get("code") or ""
        out.append(
            {
                "driver_number": int(num),
                "full_name": f'{d.get("givenName", "")} {d.get("familyName", "")}'.strip(),
                "name_acronym": (code or "")[:3] or None,
                "team_name": c.get("name"),
                "team_colour": None,
            }
        )
    return out


def _parse_session_key_query(session_key: str) -> int | str:
    if session_key == "latest":
        return "latest"
    try:
        return int(session_key)
    except ValueError:
        return session_key


def _fastf1_session_letter(kind: int) -> str:
    return {_KIND_RACE: "R", _KIND_QUALIFYING: "Q", _KIND_SPRINT: "S"}.get(kind, "R")


async def _try_fastf1_laps(y: int, rnd: int, kind: int, ttl: int = _FASTF1_ROUND_LIVE_TTL_SEC) -> list[dict]:
    code = _fastf1_session_letter(kind)
    key = f"fastf1:shape:laps:{y}:{rnd}:{code}"
    hit = await _apex_cache.get(key)
    if hit is not None:
        return hit
    loop = asyncio.get_event_loop()
    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                _get_fastf1_round_laps_openf1_shaped_sync,
                y,
                rnd,
                code,
            ),
            timeout=180.0,
        )
    except Exception:
        data = []
    rows = data if isinstance(data, list) else []
    if rows:
        await _apex_cache.set(key, rows, ttl=ttl)
    return rows


async def _try_fastf1_stints(y: int, rnd: int, kind: int, ttl: int = _FASTF1_ROUND_LIVE_TTL_SEC) -> list[dict]:
    code = _fastf1_session_letter(kind)
    key = f"fastf1:shape:stints:{y}:{rnd}:{code}"
    hit = await _apex_cache.get(key)
    if hit is not None:
        return hit
    loop = asyncio.get_event_loop()
    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                _get_fastf1_round_stints_openf1_shaped_sync,
                y,
                rnd,
                code,
            ),
            timeout=180.0,
        )
    except Exception:
        data = []
    rows = data if isinstance(data, list) else []
    if rows:
        await _apex_cache.set(key, rows, ttl=ttl)
    return rows


async def _try_fastf1_drivers(y: int, rnd: int, kind: int, ttl: int = _FASTF1_ROUND_LIVE_TTL_SEC) -> list[dict]:
    code = _fastf1_session_letter(kind)
    key = f"fastf1:shape:drivers:v2:{y}:{rnd}:{code}"
    hit = await _apex_cache.get(key)
    if hit is not None:
        return hit
    loop = asyncio.get_event_loop()
    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                _get_fastf1_round_drivers_openf1_shaped_sync,
                y,
                rnd,
                code,
            ),
            timeout=180.0,
        )
    except Exception:
        data = []
    rows = data if isinstance(data, list) else []
    if rows:
        await _apex_cache.set(key, rows, ttl=ttl)
    return rows


async def _try_fastf1_race_control(y: int, rnd: int, kind: int) -> list[dict]:
    code = _fastf1_session_letter(kind)
    key = f"fastf1:shape:rc:{y}:{rnd}:{code}"
    hit = await _apex_cache.get(key)
    if hit is not None:
        return hit
    loop = asyncio.get_event_loop()
    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                _get_fastf1_round_race_control_sync,
                y,
                rnd,
                code,
            ),
            timeout=120.0,
        )
    except Exception:
        data = []
    rows = data if isinstance(data, list) else []
    if rows:
        await _apex_cache.set(key, rows, ttl=_FASTF1_ROUND_LIVE_TTL_SEC)
    return rows


router = APIRouter(prefix="/live", tags=["live"])


@router.get("/session")
async def current_session():
    """Return the most recently active session."""
    return await openf1.get_latest_session()


@router.get("/map_session")
async def map_focus_session():
    """
    Session the UI should bind to for live map / timing (FP1–3, quali, sprint, race).
    Handles gaps between sessions by keeping the last finished session until the next starts.
    """
    return await openf1.resolve_map_focus_session()


@router.get("/sessions")
async def list_sessions(
    year: Optional[int] = Query(None, description="Filter by season year"),
    meeting_key: Optional[int] = Query(None),
    session_name: Optional[str] = Query(None, description="e.g. Race, Qualifying"),
    session_key: Optional[int] = Query(None, description="Single session row from OpenF1"),
):
    if session_key is not None:
        if session_key < 0:
            dec = _decode_synthetic_session_key(session_key)
            if not dec:
                return []
            y, rnd, kind = dec
            mk = _synthetic_meeting_key_from_yr_rnd(y, rnd)
            races = await _ergast.get_schedule(y)
            rr = next(
                (r for r in races if int(r.get("round", 0) or 0) == rnd),
                None,
            )
            circuit = (rr or {}).get("Circuit") or {}
            loc = circuit.get("Location") or {}
            return [
                {
                    "session_key": session_key,
                    "session_name": _kind_session_name(kind),
                    "meeting_key": mk,
                    "year": y,
                    "date_start": (rr or {}).get("date"),
                    "circuit_short_name": circuit.get("circuitName") or circuit.get("circuitId"),
                    "country_name": loc.get("country"),
                    "location": loc.get("locality"),
                    "meeting_name": (rr or {}).get("raceName"),
                    "data_source": "ergast",
                }
            ]
        sess_rows = await openf1.get_sessions(
            session_key=session_key,
            year=year,
            meeting_key=meeting_key,
            session_name=session_name,
        )
        if not sess_rows:
            return sess_rows
        out_sess: list[dict] = []
        for row in sess_rows:
            r = dict(row)
            yi = _infer_year_from_session_row(r)
            mk = r.get("meeting_key")
            if yi is not None and mk is not None:
                try:
                    er = await _ergast_round_for_openf1_meeting(yi, int(mk))
                    if er is not None:
                        r["round"] = er
                except Exception:
                    pass
            out_sess.append(r)
        return out_sess

    mk = meeting_key
    yr = year
    if mk is not None and mk < 0:
        decoded = _decode_synthetic_meeting_key(mk)
        if not decoded:
            return []
        y_erg, rnd = decoded
        real_mk = await _openf1_meeting_key_for_ergast_round(y_erg, rnd)
        if real_mk is None:
            return await _synthetic_sessions_for_ergast_weekend(y_erg, rnd)
        mk = real_mk
        yr = yr if yr is not None else y_erg

    return await openf1.get_sessions(
        session_key=None,
        year=yr,
        meeting_key=mk,
        session_name=session_name,
    )


async def _ergast_calendar_bundle(year: int) -> tuple[dict[str, int], list[dict]]:
    """Ergast schedule: date → round map, plus full race rows (for circuit matching)."""
    ergast_date_map: dict[str, int] = {}
    races: list[dict] = []
    try:
        races = await _ergast.get_schedule(year)
        for r in races:
            d = r.get("date")
            rnd = r.get("round")
            if d and rnd:
                try:
                    ergast_date_map[str(d)[:10]] = int(rnd)
                except (TypeError, ValueError):
                    pass
    except Exception:
        pass
    return ergast_date_map, races


async def _ergast_date_map_for_year(year: int) -> dict[str, int]:
    d, _ = await _ergast_calendar_bundle(year)
    return d


def _try_ergast_round_from_dates(row: dict, ergast_date_map: dict[str, int]) -> int | None:
    """Map OpenF1 meeting dates to an Ergast round; None if no calendar hit."""
    date_end = str(row.get("date_end") or "")[:10]
    date_start = str(row.get("date_start") or "")[:10]
    for d in (date_end, date_start):
        if d and d in ergast_date_map:
            return ergast_date_map[d]
    anchor = date_start or date_end
    if not anchor:
        return None
    try:
        a = date.fromisoformat(anchor)
        b = date.fromisoformat(date_end or date_start)
    except ValueError:
        return None
    if b < a:
        a, b = b, a
    max_days = min((b - a).days, 14)
    for i in range(max_days + 1):
        d = (a + timedelta(days=i)).isoformat()
        if d in ergast_date_map:
            return ergast_date_map[d]
    return None


def _norm_ergast_token(val: object) -> str:
    return str(val or "").strip().lower()


# OpenF1 `country_code` → extra tokens for Ergast locality / raceName matching
# (Ergast uses full country names; short codes never appear in haystacks).
_CC_EXTRA_NEEDLES: dict[str, tuple[str, ...]] = {
    "aus": ("australia", "australian", "melbourne", "albert"),
    "chn": ("china", "chinese", "shanghai"),
    "brn": ("bahrain", "sakhir"),
    "jpn": ("japan", "japanese", "suzuka"),
    "usa": ("united states", "american", "miami", "austin", "vegas"),
    "mex": ("mexico", "mexican"),
    "bra": ("brazil", "brazilian"),
    "qat": ("qatar", "losail"),
    "are": ("emirates", "abu dhabi", "yas"),
}


def _ergast_round_by_circuit_match(row: dict, ergast_races: list[dict]) -> int | None:
    """
    When date matching fails (pre-season vs GP, TZ quirks), match OpenF1 meeting text
    to Ergast Circuit / raceName. Fixes 2026+ calendars where sequential i+1 mapped
    every GP to the same Ergast round as the Nth OpenF1 row.
    """
    needles: list[str] = []
    for k in (
        "circuit_short_name",
        "location",
        "country_name",
        "meeting_name",
        "meeting_official_name",
    ):
        v = _norm_ergast_token(row.get(k))
        if len(v) >= 3:
            needles.append(v)

    cc = _norm_ergast_token(row.get("country_code"))
    if len(cc) == 3 and cc in _CC_EXTRA_NEEDLES:
        needles.extend(_CC_EXTRA_NEEDLES[cc])

    if not needles:
        return None

    def race_haystacks(race: dict) -> list[str]:
        c = race.get("Circuit") or {}
        loc = c.get("Location") or {}
        parts = [
            _norm_ergast_token(c.get("circuitId")),
            _norm_ergast_token(c.get("circuitName")),
            _norm_ergast_token(loc.get("locality")),
            _norm_ergast_token(loc.get("country")),
            _norm_ergast_token(race.get("raceName")),
        ]
        return [p for p in parts if len(p) >= 3]

    for race in ergast_races:
        stacks = race_haystacks(race)
        for n in needles:
            compact_n = n.replace(" ", "")
            for h in stacks:
                compact_h = h.replace(" ", "")
                if n in h or h in n or compact_n in compact_h or compact_h in compact_n:
                    try:
                        return int(race.get("round", 0))
                    except (TypeError, ValueError):
                        return None
    return None


def _resolve_ergast_round_for_openf1_meeting(
    row: dict,
    ergast_date_map: dict[str, int],
    ergast_races: list[dict],
    *,
    sequential_fallback: int | None,
) -> int | None:
    if row.get("ergast_round") is not None:
        try:
            return int(row["ergast_round"])
        except (TypeError, ValueError):
            pass
    r = _try_ergast_round_from_dates(row, ergast_date_map)
    if r is not None:
        return r
    r = _ergast_round_by_circuit_match(row, ergast_races)
    if r is not None:
        return r
    if not ergast_races:
        return sequential_fallback
    return None


async def _ergast_round_for_openf1_meeting(year: int, meeting_key: int) -> int | None:
    """
    Official Ergast round for an OpenF1 meeting_key + season year.
    Used to fix client race reports when OpenF1's own `round` field disagrees with the calendar.
    """
    meetings = await openf1.get_meetings(year=year)
    if not meetings:
        return None
    ergast_date_map, ergast_races = await _ergast_calendar_bundle(year)
    mki = int(meeting_key)
    for i, r in enumerate(meetings):
        try:
            mk = int(r.get("meeting_key", 0))
        except (TypeError, ValueError):
            continue
        if mk != mki:
            continue
        row = dict(r)
        return _resolve_ergast_round_for_openf1_meeting(
            row,
            ergast_date_map,
            ergast_races,
            sequential_fallback=i + 1,
        )
    return None


def _infer_year_from_session_row(row: dict) -> int | None:
    y = row.get("year")
    if y is not None:
        try:
            return int(y)
        except (TypeError, ValueError):
            pass
    ds = str(row.get("date_start") or row.get("date_end") or "")[:10]
    if len(ds) >= 4:
        try:
            return int(ds[:4])
        except ValueError:
            pass
    return None


@router.get("/meetings")
async def list_meetings(
    year: Optional[int] = Query(None),
    country_name: Optional[str] = Query(None),
):
    rows = await openf1.get_meetings(year=year, country_name=country_name)
    if rows:
        ergast_date_map: dict[str, int] = {}
        ergast_races: list[dict] = []
        if year is not None:
            ergast_date_map, ergast_races = await _ergast_calendar_bundle(year)

        out = []
        for i, r in enumerate(rows):
            row = dict(r)
            if row.get("ergast_round") is None:
                resolved = _resolve_ergast_round_for_openf1_meeting(
                    row,
                    ergast_date_map,
                    ergast_races,
                    sequential_fallback=i + 1,
                )
                if resolved is not None:
                    row["ergast_round"] = resolved
            out.append(row)
        return out
    if year is None:
        return []

    sess = await openf1.get_sessions(year=year)
    derived = _meetings_from_session_rows(sess)
    if country_name:
        cn = country_name.strip().lower()
        derived = [
            m
            for m in derived
            if cn in (str(m.get("country_name") or "").lower())
        ]
    if derived:
        return derived

    erg = await _meetings_from_ergast_schedule(year)
    if country_name:
        cn = country_name.strip().lower()
        erg = [m for m in erg if cn in (str(m.get("country_name") or "").lower())]
    return erg


@router.get("/drivers")
async def get_drivers(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return []
        y, rnd, kind = dec
        rows = await _try_fastf1_drivers(y, rnd, kind)
        if not rows:
            rows = await _synthetic_ergast_drivers(y, rnd, kind)
        if driver_number is not None:
            rows = [r for r in rows if r.get("driver_number") == driver_number]
        return rows
    return await openf1.get_drivers(
        session_key=session_key,
        driver_number=driver_number,
    )


@router.get("/car_data")
async def car_data(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
    speed_gte: Optional[int] = Query(None, description="Minimum speed filter"),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        return []
    return await openf1.get_car_data(
        session_key=session_key,
        driver_number=driver_number,
        speed_gte=speed_gte,
    )


@router.get("/position")
async def position(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
):
    """GPS x/y/z location data for track map (OpenF1 /location endpoint)."""
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        return []
    return await openf1.get_location(
        session_key=session_key,
        driver_number=driver_number,
    )


@router.get("/intervals")
async def intervals(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        return []
    return await openf1.get_intervals(
        session_key=session_key,
        driver_number=driver_number,
    )


def _normalize_openf1_lap(row: dict) -> dict:
    """Coerce driver_number + sector times so JSON clients always get usable numbers."""
    out = dict(row)
    dn = out.get("driver_number")
    if dn is not None:
        try:
            out["driver_number"] = int(dn)
        except (TypeError, ValueError):
            pass
    for k in (
        "duration_sector_1",
        "duration_sector_2",
        "duration_sector_3",
        "lap_duration",
    ):
        v = out.get(k)
        if v is None:
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            continue
        try:
            out[k] = float(str(v).strip().replace(",", "."))
        except (TypeError, ValueError):
            pass
    return out


@router.get("/laps")
async def laps(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
    lap_number: Optional[int] = Query(None),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return []
        y, rnd, kind = dec
        raw = await _try_fastf1_laps(y, rnd, kind)
        if not raw and kind == _KIND_RACE:
            raw = await _ergast_laps_openf1_shaped(y, rnd)
        if lap_number is not None:
            raw = [x for x in raw if x.get("lap_number") == lap_number]
        if driver_number is not None:
            raw = [x for x in raw if x.get("driver_number") == driver_number]
        return [_normalize_openf1_lap(dict(x)) for x in raw]
    raw = await openf1.get_laps(
        session_key=session_key,
        driver_number=driver_number,
        lap_number=lap_number,
    )
    if not isinstance(raw, list):
        return raw
    return [_normalize_openf1_lap(dict(x)) for x in raw]


@router.get("/stints")
async def stints(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
    compound: Optional[str] = Query(None, description="SOFT / MEDIUM / HARD / INTERMEDIATE / WET"),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return []
        y, rnd, kind = dec
        raw = await _try_fastf1_stints(y, rnd, kind)
        if not raw and kind == _KIND_RACE:
            raw = await _ergast_stints_from_pit_stops(y, rnd)
        if driver_number is not None:
            raw = [x for x in raw if x.get("driver_number") == driver_number]
        if compound:
            c = compound.upper()
            raw = [x for x in raw if str(x.get("compound") or "").upper() == c]
        return raw
    return await openf1.get_stints(
        session_key=session_key,
        driver_number=driver_number,
        compound=compound,
    )


@router.get("/pits")
async def pits(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(None),
    lap_number: Optional[int] = Query(None),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return []
        y, rnd, kind = dec
        if kind != _KIND_RACE:
            return []
        raw = await _ergast.get_pit_stops(y, rnd)
        dmap = await _ergast_driver_id_to_number(y, rnd)
        out = []
        for p in raw:
            did = p.get("driverId", "")
            dn = dmap.get(did)
            if dn is None:
                continue
            if driver_number is not None and dn != driver_number:
                continue
            lap = p.get("lap")
            if lap_number is not None and int(lap or 0) != lap_number:
                continue
            out.append(
                {
                    "driver_number": dn,
                    "lap_number": int(lap) if lap is not None else None,
                    "pit_duration": p.get("duration"),
                }
            )
        return out
    return await openf1.get_pits(
        session_key=session_key,
        driver_number=driver_number,
        lap_number=lap_number,
    )


@router.get("/race_control")
async def race_control(
    session_key: str = Query("latest"),
    flag: Optional[str] = Query(None, description="GREEN / YELLOW / RED / CHEQUERED / BLUE"),
    category: Optional[str] = Query(None, description="Flag / SafetyCar / DRS"),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return []
        y, rnd, kind = dec
        msgs = await _try_fastf1_race_control(y, rnd, kind)
        if flag:
            fl = flag.upper()
            msgs = [m for m in msgs if str(m.get("flag") or "").upper() == fl]
        if category:
            cat = category.upper()
            msgs = [m for m in msgs if str(m.get("category") or "").upper() == cat]
        return msgs
    return await openf1.get_race_control(
        session_key=session_key,
        flag=flag,
        category=category,
    )


@router.get("/weather")
async def weather(
    session_key: str = Query("latest"),
):
    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        return []
    return await openf1.get_weather(session_key=session_key)


@router.get("/race_snapshot")
async def race_snapshot(session_key: str = Query("latest")):
    """
    Aggregate snapshot: drivers + intervals + stints + race control.
    Useful for the Race Hub screen's initial load.
    """
    import asyncio

    sk = _parse_session_key_query(session_key)
    if isinstance(sk, int) and sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return {"session_key": session_key, "drivers": [], "weather": {}, "race_control": []}
        y, rnd, kind = dec
        drivers = await _try_fastf1_drivers(y, rnd, kind)
        if not drivers:
            drivers = await _synthetic_ergast_drivers(y, rnd, kind)
        stints = await _try_fastf1_stints(y, rnd, kind)
        if not stints and kind == _KIND_RACE:
            stints = await _ergast_stints_from_pit_stops(y, rnd)
        driver_map: dict[int, dict] = {d["driver_number"]: dict(d) for d in drivers}
        stint_map: dict[int, dict] = {}
        for s in stints:
            dn = s.get("driver_number")
            if dn:
                if dn not in stint_map or (
                    s.get("stint_number", 0) > stint_map[dn].get("stint_number", 0)
                ):
                    stint_map[dn] = s
        for dn, s in stint_map.items():
            if dn in driver_map:
                driver_map[dn]["compound"] = s.get("compound")
                driver_map[dn]["tyre_age"] = s.get("tyre_age_at_start")
                driver_map[dn]["stint_number"] = s.get("stint_number")
        rc_msgs = await _try_fastf1_race_control(y, rnd, kind)
        return {
            "session_key": session_key,
            "drivers": list(driver_map.values()),
            "weather": {},
            "race_control": rc_msgs[-10:] if rc_msgs else [],
        }

    drivers, intervals, stints, rc, weather = await asyncio.gather(
        openf1.get_drivers(session_key=session_key),
        openf1.get_intervals(session_key=session_key),
        openf1.get_stints(session_key=session_key),
        openf1.get_race_control(session_key=session_key),
        openf1.get_weather(session_key=session_key),
    )

    # Build driver map indexed by number
    driver_map = {d["driver_number"]: d for d in drivers}

    # Attach latest interval per driver
    for item in intervals:
        dn = item.get("driver_number")
        if dn and dn in driver_map:
            driver_map[dn]["gap_to_leader"] = item.get("gap_to_leader")
            driver_map[dn]["interval"] = item.get("interval")

    # Attach current tyre compound (last stint)
    stint_map: dict[int, dict] = {}
    for s in stints:
        dn = s.get("driver_number")
        if dn:
            if dn not in stint_map or (s.get("stint_number", 0) > stint_map[dn].get("stint_number", 0)):
                stint_map[dn] = s
    for dn, s in stint_map.items():
        if dn in driver_map:
            driver_map[dn]["compound"] = s.get("compound")
            driver_map[dn]["tyre_age"] = s.get("tyre_age_at_start")
            driver_map[dn]["stint_number"] = s.get("stint_number")

    latest_weather = weather[-1] if weather else {}
    latest_rc = rc[-3:] if rc else []  # Last 3 race control messages

    return {
        "session_key": session_key,
        "drivers": list(driver_map.values()),
        "weather": latest_weather,
        "race_control": latest_rc,
    }


@router.get("/race_map/{session_key}")
async def race_map(
    session_key: int,
    lap: int = Query(1, ge=1, description="Lap number to show car positions for"),
):
    """
    Historical GPS positions of all cars at a specific race lap.

    Strategy:
    1. Fetch lap-timing data for the requested lap → get date_start per driver.
    2. Open a 90-second window starting from the earliest date_start.
    3. Fetch all location records in that window (one small date-filtered request).
    4. Return the LATEST position per driver inside the window.
    5. Also return total_laps so the frontend can build the slider.
    """
    import asyncio
    from datetime import datetime, timedelta, timezone

    if session_key < 0:
        dec = _decode_synthetic_session_key(session_key)
        if not dec:
            return {"lap": lap, "session_key": session_key, "total_laps": 0, "positions": []}
        y, rnd, kind = dec
        all_laps = await _try_fastf1_laps(y, rnd, kind)
        if not all_laps and kind == _KIND_RACE:
            all_laps = await _ergast_laps_openf1_shaped(y, rnd)
        total_laps = max((l.get("lap_number", 0) for l in all_laps), default=0)
        return {
            "lap": lap,
            "session_key": session_key,
            "total_laps": total_laps,
            "positions": [],
        }

    # Parallel: lap timing for this lap + all laps (for total count)
    laps_at_n, all_laps = await asyncio.gather(
        openf1.get_laps(session_key=session_key, lap_number=lap),
        openf1.get_laps(session_key=session_key),
    )

    total_laps = max((l.get("lap_number", 0) for l in all_laps), default=0)

    empty = {"lap": lap, "session_key": session_key, "total_laps": total_laps, "positions": []}

    if not laps_at_n:
        return empty

    dates = sorted([l["date_start"] for l in laps_at_n if l.get("date_start")])
    if not dates:
        return empty

    try:
        start_dt = datetime.fromisoformat(dates[0].replace("Z", "+00:00"))
        end_dt = start_dt + timedelta(seconds=90)
        date_gte = start_dt.isoformat()
        date_lte = end_dt.isoformat()
    except Exception:
        return empty

    locations = await openf1.get_location(
        session_key=session_key,
        date_gte=date_gte,
        date_lte=date_lte,
    )

    driver_latest: dict[int, dict] = {}
    for loc in locations:
        dn = loc.get("driver_number")
        date = loc.get("date", "")
        x, y = loc.get("x"), loc.get("y")
        if dn and x is not None and y is not None and (x != 0 or y != 0):
            if dn not in driver_latest or date > driver_latest[dn].get("date", ""):
                driver_latest[dn] = loc

    return {
        "lap": lap,
        "session_key": session_key,
        "total_laps": total_laps,
        "positions": list(driver_latest.values()),
    }


def _outline_from_openf1_locations(
    positions: list,
    driver_number: Optional[int],
    sample_step: int,
) -> list[dict]:
    """
    Build a polyline from /location samples. When driver_number is omitted, pick the
    driver with the most non-zero points and sort by time so the path follows the lap.
    """
    if not positions:
        return []

    def ok_xy(p: dict) -> bool:
        x, y = p.get("x"), p.get("y")
        if x is None or y is None:
            return False
        return (x or 0) != 0 or (y or 0) != 0

    if driver_number is not None:
        rows = [p for p in positions if p.get("driver_number") == driver_number and ok_xy(p)]
    else:
        by_dn: dict[int, list] = defaultdict(list)
        for p in positions:
            dn = p.get("driver_number")
            if dn is None or not ok_xy(p):
                continue
            by_dn[int(dn)].append(p)
        if not by_dn:
            return []
        best_dn = max(by_dn.keys(), key=lambda d: len(by_dn[d]))
        rows = by_dn[best_dn]

    rows.sort(key=lambda p: str(p.get("date") or ""))
    sampled = [
        {"x": float(p["x"]), "y": float(p["y"])}
        for p in rows[::sample_step]
        if p.get("x") is not None and p.get("y") is not None
    ]
    return sampled


async def _session_row_for_track_fallback(session_key: str) -> dict:
    if session_key == "latest":
        return await openf1.resolve_map_focus_session()
    try:
        sk = int(session_key)
    except ValueError:
        return {}
    if sk < 0:
        dec = _decode_synthetic_session_key(sk)
        if not dec:
            return {}
        y, rnd, _kind = dec
        races = await _ergast.get_schedule(y)
        rr = next((r for r in races if int(r.get("round", 0) or 0) == rnd), None)
        if not rr:
            return {}
        circuit = rr.get("Circuit") or {}
        loc = circuit.get("Location") or {}
        return {
            "session_key": sk,
            "session_name": _kind_session_name(_kind),
            "meeting_key": _synthetic_meeting_key_from_yr_rnd(y, rnd),
            "year": y,
            "date_start": rr.get("date"),
            "circuit_short_name": circuit.get("circuitName") or circuit.get("circuitId"),
            "country_name": loc.get("country"),
            "location": loc.get("locality"),
            "meeting_name": rr.get("raceName"),
        }
    rows = await openf1.get_sessions(session_key=sk)
    return dict(rows[0]) if rows else {}


def _parse_iso_date_only(val) -> Optional[date]:
    """Parse OpenF1 / Ergast ISO timestamps to a calendar date (UTC)."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _ergast_round_tuple(r: dict) -> tuple[int, str] | None:
    rnd = int(r["round"]) if isinstance(r.get("round"), (int, str)) and str(r.get("round", "")).isdigit() else 0
    if rnd <= 0:
        return None
    return rnd, str(r.get("raceName") or "")


async def _ergast_round_for_openf1_session(sess: dict) -> tuple[int, int, str] | None:
    """
    Map OpenF1 session → Ergast round for FastF1 circuit outline.

    Order: (1) calendar proximity session↔race weekend, (2) OpenF1 meeting metadata,
    (3) circuit / locality string match, (4) country only if unambiguous.
    The old “first country match” logic could attach China/Japan to the wrong round.
    """
    if not sess:
        return None
    try:
        y = int(sess.get("year"))
    except (TypeError, ValueError):
        return None

    races = await _ergast.get_schedule(y)
    if not races:
        return None

    # ── 1) Session date vs Ergast race date (quali/FP are 0–4 days from Sunday race) ─
    sess_day = _parse_iso_date_only(sess.get("date_start"))
    if sess_day:
        best_r = None
        best_d = 99
        for r in races:
            rd = _parse_iso_date_only(r.get("date"))
            if rd is None:
                continue
            delta = abs((sess_day - rd).days)
            if delta <= 4 and delta < best_d:
                best_d = delta
                best_r = r
        if best_r:
            t = _ergast_round_tuple(best_r)
            if t:
                return y, t[0], t[1]

    # ── 2) OpenF1 meeting row (same weekend as session_key) ─
    mk = sess.get("meeting_key")
    if mk is not None:
        try:
            mlist = await openf1.get_meetings(meeting_key=int(mk), year=y)
        except (TypeError, ValueError):
            mlist = []
        if mlist:
            m = mlist[0]
            md = _parse_iso_date_only(m.get("date_start"))
            if md:
                best_r = None
                best_d = 99
                for r in races:
                    rd = _parse_iso_date_only(r.get("date"))
                    if rd is None:
                        continue
                    delta = abs((md - rd).days)
                    if delta <= 4 and delta < best_d:
                        best_d = delta
                        best_r = r
                if best_r:
                    t = _ergast_round_tuple(best_r)
                    if t:
                        return y, t[0], t[1]

            mcircuit = (m.get("circuit_short_name") or "").strip().lower()
            mloc = (m.get("location") or "").strip().lower()
            mcountry = (m.get("country_name") or "").strip().lower()
            for r in races:
                c = r.get("Circuit") or {}
                loc_e = ((c.get("Location") or {}).get("locality") or "").lower()
                ctry = ((c.get("Location") or {}).get("country") or "").lower()
                cname = (c.get("circuitName") or "").lower()
                rname = (r.get("raceName") or "").lower()
                t = _ergast_round_tuple(r)
                if not t:
                    continue
                rnd, rnm = t
                token = mcircuit.split()[0] if mcircuit else ""
                if mcircuit and (mcircuit in cname or (token and token in cname)):
                    return y, rnd, rnm
                if mloc and (mloc in loc_e or loc_e in mloc or mloc in rname):
                    return y, rnd, rnm
            if mcountry:
                hits = [
                    x
                    for x in races
                    if (
                        ((x.get("Circuit") or {}).get("Location") or {}).get("country") or ""
                    ).strip().lower()
                    == mcountry
                ]
                if len(hits) == 1:
                    tt = _ergast_round_tuple(hits[0])
                    if tt:
                        return y, tt[0], tt[1]

    # ── 3) Session row text fields ─
    circuit_short = (sess.get("circuit_short_name") or "").strip().lower()
    loc = (sess.get("location") or "").strip().lower()
    country = (sess.get("country_name") or "").strip().lower()
    for r in races:
        c = r.get("Circuit") or {}
        loc_e = ((c.get("Location") or {}).get("locality") or "").lower()
        ctry = ((c.get("Location") or {}).get("country") or "").lower()
        cname = (c.get("circuitName") or "").lower()
        rname = (r.get("raceName") or "").lower()
        t = _ergast_round_tuple(r)
        if not t:
            continue
        rnd, rnm = t
        token = circuit_short.split()[0] if circuit_short else ""
        if circuit_short and (circuit_short in cname or (token and token in cname)):
            return y, rnd, rnm
        if loc and (loc in loc_e or loc_e in loc or loc in rname):
            return y, rnd, rnm

    if country:
        hits = []
        for r in races:
            ctry = ((r.get("Circuit") or {}).get("Location") or {}).get("country") or ""
            if ctry.strip().lower() == country:
                hits.append(r)
        if len(hits) == 1:
            t = _ergast_round_tuple(hits[0])
            if t:
                return y, t[0], t[1]

    return None


@router.get("/track_path")
async def track_path(
    session_key: str = Query("latest"),
    driver_number: Optional[int] = Query(
        None,
        description="Reference driver number for trace. Omit to auto-select best series.",
    ),
):
    """
    Circuit outline for the map: prefer OpenF1 GPS trace (richest driver, time-sorted),
    else FastF1 layout for this Grand Prix (practice/quali often have no outline in OpenF1).
    """
    positions = await openf1.get_location(
        session_key=session_key,
        driver_number=driver_number,
    )
    path = _outline_from_openf1_locations(positions, driver_number, _TRACK_SAMPLE_STEP)
    outline_source = "openf1" if len(path) >= 16 else "none"

    if len(path) < 16:
        sess = await _session_row_for_track_fallback(session_key)
        rr = await _ergast_round_for_openf1_session(sess)
        if rr:
            year, rnd, ev_name = rr
            try:
                from routers.telemetry import _executor, _get_circuit_map_sync

                loop = asyncio.get_event_loop()
                data = await asyncio.wait_for(
                    loop.run_in_executor(
                        _executor, _get_circuit_map_sync, year, rnd, ev_name or "",
                    ),
                    timeout=180.0,
                )
                fp = data.get("path") or []
                if len(fp) >= 16:
                    path = fp
                    outline_source = "fastf1"
            except Exception:
                pass

    return {
        "session_key": session_key,
        "path": path,
        "outline_source": outline_source,
    }
