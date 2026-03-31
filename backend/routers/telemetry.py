"""
FastF1 telemetry endpoints.
FastF1 loads session data from the F1 Livetiming CDN and parses it locally.
Results are cached to disk via FastF1's built-in cache.
"""

import asyncio
import os
from functools import lru_cache
from fastapi import APIRouter, Query, Path, HTTPException
from typing import Optional

from services import cache as _cache

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

# Circuit outlines rarely change — cache JSON aggressively (Redis if configured).
_CIRCUIT_MAP_TTL_SEC = int(os.getenv("CIRCUIT_MAP_CACHE_TTL", str(14 * 24 * 3600)))
# FastF1 session data (drivers/laps/stints) for a completed race never changes.
# Default 6 h; override with FASTF1_LIVE_CACHE_TTL env var (e.g. "180" for live-session dev).
_FASTF1_ROUND_LIVE_TTL_SEC = int(os.getenv("FASTF1_LIVE_CACHE_TTL", str(6 * 3600)))
# Finished-race data is immutable — cache for 7 days so re-parsing never re-triggers.
_FASTF1_FINISHED_TTL_SEC = int(os.getenv("FASTF1_FINISHED_CACHE_TTL", str(7 * 24 * 3600)))

# FastF1 is CPU-bound; run in thread pool to avoid blocking the event loop
import concurrent.futures
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def _setup_fastf1():
    import fastf1
    # Use a persistent directory — /tmp is wiped on restart
    default_cache = os.path.join(os.path.expanduser("~"), ".cache", "fastf1")
    cache_dir = os.getenv("FASTF1_CACHE_DIR", default_cache)
    os.makedirs(cache_dir, exist_ok=True)
    fastf1.Cache.enable_cache(cache_dir)
    return fastf1


def _pick_laps_for_driver(session, driver_code: str, driver_number: int | None):
    """TLA can mismatch lap table vs our API; fall back to permanent number."""
    code = (driver_code or "").strip().upper()
    laps = session.laps.pick_drivers(code)
    if len(laps) == 0 and driver_number is not None:
        laps = session.laps.pick_drivers(driver_number)
    return laps


def _open_telemetry_session(
    ff1,
    year: int,
    event: str,
    session_name: str,
    meeting_name: str | None = None,
):
    """
    Open a FastF1 session with laps + telemetry. Ergast round index can differ from
    FastF1's archive for the current season; meeting name + prior-year retries fix empty sessions.
    """
    meeting_name = (meeting_name or "").strip() or None
    round_int: int | None = None
    try:
        round_int = int(str(event).strip())
    except ValueError:
        pass

    def _try(y: int, ident) -> object | None:
        session = ff1.get_session(y, ident, session_name)
        session.load(telemetry=True)
        laps = getattr(session, "laps", None)
        if laps is not None and len(laps) > 0:
            return session
        return None

    last_exc: Exception | None = None
    # Same calendar year: Ergast round, then official GP name
    for ident in ([round_int] if round_int is not None else []) + ([meeting_name] if meeting_name else []):
        try:
            s = _try(year, ident)
            if s is not None:
                return s
        except Exception as e:
            last_exc = e
    # Archive often lags: same GP name in previous seasons
    if meeting_name:
        for prev_y in (year - 1, year - 2):
            if prev_y < 2000:
                break
            try:
                s = _try(prev_y, meeting_name)
                if s is not None:
                    return s
            except Exception as e:
                last_exc = e
    if last_exc:
        raise last_exc
    raise RuntimeError("FastF1 returned no laps for this session (try another year or GP).")


def _load_session_sync(year: int, event: str, session_name: str):
    """Blocking FastF1 session load — run in thread pool."""
    ff1 = _setup_fastf1()
    session = ff1.get_session(year, event, session_name)
    session.load(telemetry=True, weather=True, messages=True)
    return session


def _get_lap_telemetry_sync(
    year: int,
    event: str,
    session_name: str,
    driver: str,
    lap_number: int | None,
    driver_number: int | None = None,
    meeting_name: str | None = None,
):
    """Parse laps and telemetry for a driver — blocking."""
    ff1 = _setup_fastf1()
    session = _open_telemetry_session(ff1, year, event, session_name, meeting_name)

    laps = _pick_laps_for_driver(session, driver, driver_number)
    if lap_number is not None:
        laps = laps[laps["LapNumber"] == lap_number]

    results = []
    for _, lap in laps.iterrows():
        try:
            tel = lap.get_telemetry()
            tel_records = []
            for _, row in tel.iterrows():
                tel_records.append({
                    "time_ms": row["Time"].total_seconds() * 1000 if hasattr(row["Time"], "total_seconds") else 0,
                    "speed": float(row["Speed"]) if "Speed" in row else None,
                    "rpm": float(row["RPM"]) if "RPM" in row else None,
                    "gear": int(row["nGear"]) if "nGear" in row else None,
                    "throttle": float(row["Throttle"]) if "Throttle" in row else None,
                    "brake": bool(row["Brake"]) if "Brake" in row else None,
                    "drs": int(row["DRS"]) if "DRS" in row else None,
                    "x": float(row["X"]) if "X" in row else None,
                    "y": float(row["Y"]) if "Y" in row else None,
                    "z": float(row["Z"]) if "Z" in row else None,
                })

            lap_time = lap["LapTime"]
            lap_time_str = str(lap_time) if lap_time is not None and str(lap_time) != "NaT" else None

            results.append({
                "driver": driver,
                "lap_number": int(lap["LapNumber"]),
                "lap_time": lap_time_str,
                "compound": lap.get("Compound"),
                "tyre_life": int(lap["TyreLife"]) if lap.get("TyreLife") is not None else None,
                "is_personal_best": bool(lap["IsPersonalBest"]) if "IsPersonalBest" in lap.index else None,
                "telemetry": tel_records,
            })
        except Exception:
            continue

    return results


def _get_fastest_lap_comparison_sync(
    year: int,
    event: str,
    session_name: str,
    drivers: list[str],
    fallback_driver_number: int | None = None,
    meeting_name: str | None = None,
):
    """Compare fastest laps across multiple drivers — blocking."""
    ff1 = _setup_fastf1()
    session = _open_telemetry_session(ff1, year, event, session_name, meeting_name)

    comparisons = []
    for driver in drivers:
        try:
            dn = fallback_driver_number if len(drivers) == 1 else None
            drv_laps = _pick_laps_for_driver(session, driver, dn)
            if len(drv_laps) == 0:
                continue
            lap = drv_laps.pick_fastest()
            tel = lap.get_telemetry()
            tel_records = []
            for _, row in tel.iterrows():
                tel_records.append({
                    "time_ms": row["Time"].total_seconds() * 1000 if hasattr(row["Time"], "total_seconds") else 0,
                    "speed": float(row["Speed"]) if "Speed" in row else None,
                    "distance": float(row["Distance"]) if "Distance" in row else None,
                    "gear": int(row["nGear"]) if "nGear" in row else None,
                    "throttle": float(row["Throttle"]) if "Throttle" in row else None,
                    "brake": bool(row["Brake"]) if "Brake" in row else None,
                })
            lap_time = lap["LapTime"]
            comparisons.append({
                "driver": driver,
                "lap_time": str(lap_time) if lap_time is not None and str(lap_time) != "NaT" else None,
                "lap_number": int(lap["LapNumber"]),
                "compound": lap.get("Compound"),
                "telemetry": tel_records,
            })
        except Exception:
            continue

    return comparisons


def _get_session_laps_sync(year: int, event: str, session_name: str):
    """Return all laps summary (no telemetry) for a session — blocking."""
    ff1 = _setup_fastf1()
    session = ff1.get_session(year, event, session_name)
    session.load(telemetry=False, weather=False)

    laps = session.laps
    results = []
    for _, lap in laps.iterrows():
        lap_time = lap.get("LapTime")
        lap_time_str = str(lap_time) if lap_time is not None and str(lap_time) != "NaT" else None
        results.append({
            "driver": lap.get("Driver"),
            "driver_number": int(lap["DriverNumber"]) if lap.get("DriverNumber") is not None else None,
            "lap_number": int(lap["LapNumber"]) if lap.get("LapNumber") is not None else None,
            "lap_time": lap_time_str,
            "compound": lap.get("Compound"),
            "tyre_life": int(lap["TyreLife"]) if lap.get("TyreLife") is not None else None,
            "stint": int(lap["Stint"]) if lap.get("Stint") is not None else None,
            "is_personal_best": bool(lap["IsPersonalBest"]) if "IsPersonalBest" in lap.index else None,
            "pit_in_time": str(lap.get("PitInTime")) if lap.get("PitInTime") is not None else None,
            "pit_out_time": str(lap.get("PitOutTime")) if lap.get("PitOutTime") is not None else None,
        })
    return results


def _td_to_seconds(val) -> float | None:
    if val is None:
        return None
    s = str(val)
    if s in ("NaT", "nan", "None"):
        return None
    try:
        if hasattr(val, "total_seconds"):
            return float(val.total_seconds())
        return float(val)
    except (TypeError, ValueError):
        return None


def _get_fastf1_round_laps_openf1_shaped_sync(year: int, round_num: int, session_code: str) -> list[dict]:
    """
    Same lap shape as OpenF1 /live/laps (sectors + lap_duration) using FastF1 timing CDN.
    session_code: R, Q, S (Sprint), etc.
    """
    import pandas as pd

    ff1 = _setup_fastf1()
    session = ff1.get_session(year, round_num, session_code)
    session.load(laps=True, telemetry=False, weather=False, messages=True)

    laps = session.laps
    if laps is None or len(laps) == 0:
        return []

    out: list[dict] = []
    for _, lap in laps.iterrows():
        dn = lap.get("DriverNumber")
        ln = lap.get("LapNumber")
        if pd.isna(dn) or pd.isna(ln):
            continue
        lt = _td_to_seconds(lap.get("LapTime"))
        pit_out = False
        if "PitOutTime" in lap.index and lap.get("PitOutTime") is not None and not pd.isna(
            lap.get("PitOutTime")
        ):
            pit_out = True
        out.append(
            {
                "driver_number": int(dn),
                "lap_number": int(ln),
                "lap_duration": lt,
                "duration_sector_1": _td_to_seconds(lap.get("Sector1Time")),
                "duration_sector_2": _td_to_seconds(lap.get("Sector2Time")),
                "duration_sector_3": _td_to_seconds(lap.get("Sector3Time")),
                "is_pit_out_lap": pit_out,
            }
        )
    return out


def _get_fastf1_round_stints_openf1_shaped_sync(year: int, round_num: int, session_code: str) -> list[dict]:
    """Stints with real compounds from FastF1 (per-lap stint counter)."""
    import pandas as pd

    ff1 = _setup_fastf1()
    session = ff1.get_session(year, round_num, session_code)
    session.load(laps=True, telemetry=False, weather=False, messages=True)
    laps = session.laps
    if laps is None or len(laps) == 0:
        return []

    stints: list[dict] = []
    for (dn, stint_id), group in laps.groupby(["DriverNumber", "Stint"], sort=False):
        if pd.isna(dn) or pd.isna(stint_id):
            continue
        g = group.sort_values("LapNumber")
        first = g.iloc[0]
        last = g.iloc[-1]
        comp = first.get("Compound")
        compound = str(comp).upper() if comp is not None and not pd.isna(comp) else "UNKNOWN"
        stints.append(
            {
                "driver_number": int(dn),
                "stint_number": int(stint_id),
                "lap_start": int(first["LapNumber"]),
                "lap_end": int(last["LapNumber"]),
                "compound": compound,
            }
        )
    return stints


def _get_fastf1_round_drivers_openf1_shaped_sync(year: int, round_num: int, session_code: str) -> list[dict]:
    import pandas as pd

    ff1 = _setup_fastf1()
    session = ff1.get_session(year, round_num, session_code)
    session.load(laps=True, telemetry=False, weather=False, messages=False)
    laps = session.laps
    if laps is None or len(laps) == 0:
        return []

    # session.results is populated by load(); includes HeadshotUrl / TeamColor (OpenF1-shaped drivers need these).
    res_by_num: dict[int, dict] = {}
    try:
        res = session.results
        if res is not None and len(res) > 0:
            for _, r in res.iterrows():
                try:
                    raw_dn = r.get("DriverNumber")
                    if raw_dn is None or (isinstance(raw_dn, float) and pd.isna(raw_dn)):
                        continue
                    num = int(float(raw_dn))
                except (TypeError, ValueError):
                    continue
                entry: dict = {}
                hu = r.get("HeadshotUrl")
                if hu is not None and not pd.isna(hu) and str(hu).strip():
                    entry["headshot_url"] = str(hu).strip()
                tc = r.get("TeamColor")
                if tc is not None and not pd.isna(tc) and str(tc).strip():
                    entry["team_colour"] = str(tc).strip().lstrip("#")
                fn = r.get("FullName")
                if fn is not None and not pd.isna(fn) and str(fn).strip():
                    entry["full_name"] = str(fn).strip()
                ab = r.get("Abbreviation")
                if ab is not None and not pd.isna(ab) and str(ab).strip():
                    entry["name_acronym"] = str(ab).strip().upper()[:3]
                tn = r.get("TeamName")
                if tn is not None and not pd.isna(tn) and str(tn).strip():
                    entry["team_name"] = str(tn).strip()
                if entry:
                    res_by_num[num] = entry
    except Exception:
        pass

    seen: set[int] = set()
    out: list[dict] = []
    for dn in laps["DriverNumber"].dropna().unique():
        try:
            n = int(dn)
        except (TypeError, ValueError):
            continue
        if n in seen:
            continue
        seen.add(n)
        row = laps[laps["DriverNumber"] == dn].iloc[0]
        code = row.get("Driver")
        extra = res_by_num.get(n, {})
        full_name = extra.get("full_name") or (
            str(code) if code is not None and not pd.isna(code) else ""
        )
        name_acronym = extra.get("name_acronym")
        if not name_acronym and code is not None:
            name_acronym = str(code).upper()[:3]
        team_name = extra.get("team_name")
        if team_name is None:
            team_name = row.get("Team") if "Team" in row.index else None
        out.append(
            {
                "driver_number": n,
                "full_name": full_name,
                "name_acronym": name_acronym,
                "team_name": team_name,
                "team_colour": extra.get("team_colour"),
                "headshot_url": extra.get("headshot_url"),
            }
        )
    out.sort(key=lambda x: x["driver_number"])
    return out


def _get_fastf1_round_race_control_sync(year: int, round_num: int, session_code: str) -> list[dict]:
    """Race control / track messages (track limits, flags, etc.) from FastF1."""
    import pandas as pd

    ff1 = _setup_fastf1()
    session = ff1.get_session(year, round_num, session_code)
    session.load(laps=False, telemetry=False, weather=False, messages=True)
    df = session.race_control_messages
    if df is None or len(df) == 0:
        return []
    rows = []
    for _, r in df.iterrows():
        msg = r.get("Message", "")
        if pd.isna(msg):
            msg = ""
        t = r.get("Time")
        if hasattr(t, "isoformat"):
            t_s = t.isoformat()
        else:
            t_s = str(t) if t is not None and not pd.isna(t) else ""
        lap_n = r.get("Lap")
        rows.append(
            {
                "category": str(r.get("Category", "") or "") if pd.notna(r.get("Category")) else "",
                "flag": str(r.get("Flag", "") or "") if pd.notna(r.get("Flag")) else "",
                "message": str(msg),
                "lap_number": int(lap_n) if lap_n is not None and pd.notna(lap_n) else None,
                "date": t_s,
            }
        )
    return rows[-200:]


def _load_circuit_by_name(ff1, event_name: str):
    """
    Find the circuit X/Y layout by searching recent years for a matching event name.
    Tries the most recent 5 seasons.
    Returns (path, actual_year, matched_event_name).
    """
    import pandas as pd
    import datetime
    current_year = datetime.datetime.now().year

    for try_year in range(current_year, current_year - 5, -1):
        try:
            session = ff1.get_session(try_year, event_name, "R")
            session.load(telemetry=True, weather=False, messages=False)
            if len(session.laps) == 0:
                continue
            fastest = session.laps.pick_fastest()
            tel = fastest.get_telemetry()
            path = []
            for _, row in tel.iterrows():
                x, y = row.get("X"), row.get("Y")
                if x is not None and y is not None and not pd.isna(x) and not pd.isna(y):
                    path.append({"x": int(x), "y": int(y)})
            if path:
                ev = getattr(session, "event", None)
                matched = ev.get("EventName", event_name) if ev is not None else event_name
                return path, try_year, str(matched)
        except Exception:
            continue
    return [], 0, event_name


def _load_circuit_path_with_fallback(ff1, year: int, round_num: int, event_name: str = ""):
    """
    Try to load circuit X/Y from FastF1.
    - If event_name is given, search by name across recent seasons.
    - Otherwise fall back to round_num in year, then year-1.
    Returns (path, actual_year, event_name).
    """
    import pandas as pd

    # Named search is more reliable across season re-numbering
    if event_name:
        path, actual_year, matched = _load_circuit_by_name(ff1, event_name)
        if path:
            return path, actual_year, matched

    # Fall back to round-based lookup for current then previous year
    for try_year in [year, year - 1]:
        try:
            session = ff1.get_session(try_year, round_num, "R")
            session.load(telemetry=True, weather=False, messages=False)
            if len(session.laps) == 0:
                continue
            fastest = session.laps.pick_fastest()
            tel = fastest.get_telemetry()
            path = []
            for _, row in tel.iterrows():
                x, y = row.get("X"), row.get("Y")
                if x is not None and y is not None and not pd.isna(x) and not pd.isna(y):
                    path.append({"x": int(x), "y": int(y)})
            if path:
                ev = getattr(session, "event", None)
                ev_name = ev.get("EventName", "") if ev is not None else ""
                return path, try_year, str(ev_name)
        except Exception:
            continue
    return [], year, event_name


def _get_circuit_map_sync(year: int, round_num: int, event_name: str = "") -> dict:
    """
    Circuit X/Y layout via FastF1 (falls back to named search + year-1).
    Lap-by-lap race positions come from Ergast (lap_evolution) and are
    NOT included here — the frontend merges the two data sources.
    """
    ff1 = _setup_fastf1()
    path, actual_year, ev_name = _load_circuit_path_with_fallback(ff1, year, round_num, event_name)

    return {
        "year": year,
        "actual_year": actual_year,
        "round": round_num,
        "event_name": ev_name,
        "path": path,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/{year}/{round_num}/circuit_map")
async def circuit_map(
    year: int = Path(..., description="Season year, e.g. 2026"),
    round_num: int = Path(..., description="Race round number, e.g. 3"),
    event_name: str = Query("", description="Race/event name for accurate cross-year lookup, e.g. 'Chinese Grand Prix'"),
):
    """
    Circuit X/Y layout for a historical race using FastF1.

    Falls back to (year−1, same round) if the requested year has no telemetry
    yet (e.g. current F1 season not yet in FastF1's data archive).

    Per-lap car positions are NOT returned here — the frontend combines this
    circuit outline with Ergast lap_evolution data to place cars on the track.

    First call may take 15–60 s to download; then served from Redis (if set) or
    FastF1 disk cache — instant.
    """
    cache_key = f"telemetry:circuit_map:{year}:{round_num}:{event_name or '_'}"

    hit = await _cache.get(cache_key)
    if hit is not None:
        return hit

    loop = asyncio.get_event_loop()
    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(_executor, _get_circuit_map_sync, year, round_num, event_name),
            timeout=180.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="FastF1 data download timed out — please retry.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FastF1 error: {str(e)}")

    path = data.get("path") or []
    if isinstance(path, list) and len(path) >= 16:
        await _cache.set(cache_key, data, ttl=_CIRCUIT_MAP_TTL_SEC)
    return data


@router.get("/{year}/{event}/{session}/driver/{driver}")
async def driver_lap_telemetry(
    year: int = Path(..., description="Season year, e.g. 2024"),
    event: str = Path(..., description="Event name or round number, e.g. 'Monza' or '14'"),
    session: str = Path(..., description="Session name: R / Q / FP1 / FP2 / FP3 / S"),
    driver: str = Path(..., description="3-letter driver code e.g. VER, HAM"),
    lap: Optional[int] = Query(None, description="Specific lap number; omit for all laps"),
    driver_number: Optional[int] = Query(
        None,
        description="Permanent car number — used if TLA does not match FastF1 laps",
    ),
    meeting_name: Optional[str] = Query(
        None,
        description="Race title e.g. Japanese Grand Prix — helps FastF1 when round/year archive lags",
    ),
):
    """
    Full telemetry (speed, RPM, gear, throttle, brake, DRS, position) for a
    driver across all laps or a specific lap.
    """
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(
            _executor,
            _get_lap_telemetry_sync,
            year, event, session, driver.upper(), lap, driver_number, meeting_name,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FastF1 error: {str(e)}")
    return {"year": year, "event": event, "session": session, "driver": driver.upper(), "laps": data}


@router.get("/{year}/{event}/{session}/compare")
async def fastest_lap_comparison(
    year: int = Path(...),
    event: str = Path(...),
    session: str = Path(...),
    drivers: str = Query(..., description="Comma-separated driver codes e.g. VER,HAM,LEC"),
    driver_number: Optional[int] = Query(
        None,
        description="When a single driver is requested, fallback if TLA does not match laps",
    ),
    meeting_name: Optional[str] = Query(
        None,
        description="Race title e.g. Japanese Grand Prix — helps FastF1 when round/year archive lags",
    ),
):
    """
    Compare fastest laps between multiple drivers — speed traces, gear maps, etc.
    Perfect for the Telemetry screen overlay view.
    """
    driver_list = [d.strip().upper() for d in drivers.split(",") if d.strip()]
    if not driver_list:
        raise HTTPException(status_code=400, detail="Provide at least one driver code")

    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(
            _executor,
            _get_fastest_lap_comparison_sync,
            year, event, session, driver_list, driver_number, meeting_name,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FastF1 error: {str(e)}")
    return {"year": year, "event": event, "session": session, "comparisons": data}


@router.get("/{year}/{event}/{session}/laps")
async def session_laps(
    year: int = Path(...),
    event: str = Path(...),
    session: str = Path(...),
):
    """
    All laps summary for a session (no raw telemetry — use /driver endpoint
    for that). Useful for LapLog and TyreTracker screens.
    """
    loop = asyncio.get_event_loop()
    try:
        data = await loop.run_in_executor(
            _executor,
            _get_session_laps_sync,
            year, event, session,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FastF1 error: {str(e)}")
    return {"year": year, "event": event, "session": session, "laps": data}
