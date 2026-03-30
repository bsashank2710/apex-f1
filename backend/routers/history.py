"""
Historical data endpoints — powered by the Ergast/Jolpica API.
"""

from datetime import date

from fastapi import APIRouter, HTTPException, Query, Path
from typing import Optional
from services import ergast
from services import cache as _response_cache

router = APIRouter(prefix="/history", tags=["history"])

# Synthetic session keys (must match routers/live.py)
_SYNTH_SK_YEAR_MUL = 1_000_000
_SYNTH_SK_ROUND_MUL = 10_000
_SYNTHETIC_MK_ROUND_MOD = 1000
_KIND_RACE = 1


def _encode_synthetic_session_key(year: int, rnd: int, kind: int) -> int:
    return -(year * _SYNTH_SK_YEAR_MUL + rnd * _SYNTH_SK_ROUND_MUL + kind)


def _synthetic_meeting_key(year: int, rnd: int) -> int:
    return -(year * _SYNTHETIC_MK_ROUND_MOD + rnd)


# ── Schedule ──────────────────────────────────────────────────────────────────

@router.get("/schedule/{year}")
async def race_schedule(
    year: str = Path(..., description="Season year or 'current'"),
):
    """Full race calendar for a given season."""
    return await ergast.get_schedule(year)


@router.get("/next_race")
async def next_race():
    """Return the next upcoming race on the calendar."""
    race = await ergast.get_next_race()
    if race is None:
        return {"message": "No upcoming races found for the current season."}
    return race


async def _last_finished_race_in_season(year_str: str) -> dict | None:
    """Most recent race whose date is strictly before today (ISO)."""
    races = await ergast.get_schedule(year_str)
    today = date.today().isoformat()
    # Include the GP whose race *day* is today (Ergast date is Sunday); strict `<` would skip it
    # and leave “China” as latest while Japan is literally the current round.
    finished = [r for r in races if (r.get("date") or "") <= today]
    if not finished:
        return None
    return max(finished, key=lambda r: r.get("date", ""))


async def _last_finished_gp_globally() -> dict | None:
    """
    Latest completed Grand Prix by calendar date across recent seasons.

    A single-season scan (e.g. only 2026) can return an early round (China) while a later
    round in the same calendar year (Japan) has already run — we must merge schedules.
    """
    cy = date.today().year
    today_s = date.today().isoformat()
    merged: list[dict] = []
    for ys in (str(cy), str(cy - 1), str(cy - 2)):
        merged.extend(await ergast.get_schedule(ys))
    finished = [r for r in merged if (r.get("date") or "") <= today_s]
    if not finished:
        return None
    return max(finished, key=lambda r: r.get("date", ""))


async def _fallback_race_from_ergast_last_results() -> dict | None:
    """
    When schedule-date scanning finds no “finished” race (host clock quirks, Jolpica edge cases),
    Ergast's current/last/results still points at the latest race with a classification.
    """
    try:
        data = await ergast._get("/current/last/results")
        races = ergast._mr(data).get("RaceTable", {}).get("Races", [])
        return races[0] if races else None
    except Exception:
        return None


@router.get("/finished_default_session")
async def finished_default_session(
    year: Optional[str] = Query(
        None,
        description="Season year; omit for global latest finished GP",
    ),
):
    """
    Default **Race** session for finished-races mode: **latest completed GP by date**
    (merged across recent seasons). Returns a negative synthetic session_key — no OpenF1.
    """
    today_s = date.today().isoformat()
    cache_key = f"history:finished_default_session:{today_s}:{year or 'default'}"
    hit = await _response_cache.get(cache_key)
    if hit is not None:
        return hit

    cy = date.today().year
    race: dict | None = None
    used_year: str | None = None

    if year and year.strip() and year != "current":
        race = await _last_finished_race_in_season(year.strip())
        used_year = year.strip()
    else:
        race = await _last_finished_gp_globally()
        if race:
            used_year = str(race.get("season") or cy)

    if not race:
        race = await _fallback_race_from_ergast_last_results()
        if race:
            used_year = str(race.get("season") or cy)

    if not race:
        raise HTTPException(
            status_code=404,
            detail="No finished races found for the requested season(s).",
        )

    yr = int(race.get("season") or used_year or cy)
    rnd = int(race["round"])
    circuit = race.get("Circuit") or {}
    loc = circuit.get("Location") or {}
    sk = _encode_synthetic_session_key(yr, rnd, _KIND_RACE)
    mk = _synthetic_meeting_key(yr, rnd)

    payload = {
        "session_key": sk,
        "meeting_key": mk,
        "year": yr,
        "round": rnd,
        "session_name": "Race",
        "meeting_name": race.get("raceName"),
        "circuit_short_name": circuit.get("circuitName") or circuit.get("circuitId"),
        "country_name": loc.get("country"),
        "location": loc.get("locality"),
        "date_start": race.get("date"),
    }
    await _response_cache.set(cache_key, payload, ttl=300)
    return payload


# ── Race Results ──────────────────────────────────────────────────────────────

@router.get("/results/{year}/{round}")
async def race_results(
    year: str = Path(...),
    round: str = Path(...),
):
    """Race classification results."""
    return await ergast.get_race_results(year=year, round_=round)


@router.get("/qualifying/{year}/{round}")
async def qualifying_results(
    year: str = Path(...),
    round: str = Path(...),
):
    return await ergast.get_qualifying_results(year=year, round_=round)


@router.get("/sprint/{year}/{round}")
async def sprint_results(
    year: str = Path(...),
    round: str = Path(...),
):
    return await ergast.get_sprint_results(year=year, round_=round)


# ── Lap Times & Pit Stops ─────────────────────────────────────────────────────

@router.get("/laps/{year}/{round}")
async def lap_times(
    year: str = Path(...),
    round: str = Path(...),
    lap: Optional[int] = Query(None, description="Specific lap number"),
    driver_id: Optional[str] = Query(None, description="Driver ID e.g. hamilton"),
):
    return await ergast.get_lap_times(
        year=year, round_=round, lap=lap, driver_id=driver_id
    )


@router.get("/pitstops/{year}/{round}")
async def pit_stops(
    year: str = Path(...),
    round: str = Path(...),
    stop: Optional[int] = Query(None, description="Stop number"),
    driver_id: Optional[str] = Query(None),
):
    return await ergast.get_pit_stops(
        year=year, round_=round, stop=stop, driver_id=driver_id
    )


# ── Standings ─────────────────────────────────────────────────────────────────

@router.get("/standings/drivers")
async def driver_standings(
    year: str = Query("current"),
    round: Optional[str] = Query(None, description="After specific round"),
):
    return await ergast.get_driver_standings(year=year, round_=round)


@router.get("/standings/constructors")
async def constructor_standings(
    year: str = Query("current"),
    round: Optional[str] = Query(None),
):
    return await ergast.get_constructor_standings(year=year, round_=round)


# ── Drivers & Constructors ────────────────────────────────────────────────────

@router.get("/drivers")
async def drivers(year: str = Query("current")):
    return await ergast.get_drivers(year)


@router.get("/drivers/{driver_id}")
async def driver_info(driver_id: str = Path(..., description="e.g. hamilton, max_verstappen")):
    info = await ergast.get_driver_info(driver_id)
    if info is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Driver '{driver_id}' not found")
    return info


@router.get("/constructors")
async def constructors(year: str = Query("current")):
    return await ergast.get_constructors(year)


# ── Circuits ──────────────────────────────────────────────────────────────────

@router.get("/circuits")
async def circuits(year: str = Query("current")):
    return await ergast.get_circuits(year)


@router.get("/circuits/{circuit_id}/history")
async def circuit_history(
    circuit_id: str = Path(..., description="e.g. monza, silverstone"),
    limit: int = Query(5, ge=1, le=20, description="Number of past results to return"),
):
    return await ergast.get_circuit_results(circuit_id=circuit_id, limit=limit)


# ── Season Overview ───────────────────────────────────────────────────────────

@router.get("/season_overview")
async def season_overview(year: str = Query("current")):
    """
    Combined season overview: schedule + driver standings + constructor standings.
    Used by the Standings screen.
    """
    import asyncio
    schedule, driver_standings, constructor_standings = await asyncio.gather(
        ergast.get_schedule(year),
        ergast.get_driver_standings(year),
        ergast.get_constructor_standings(year),
    )
    return {
        "year": year,
        "schedule": schedule,
        "driver_standings": driver_standings,
        "constructor_standings": constructor_standings,
    }


# ── Race Report (combined) ────────────────────────────────────────────────────

@router.get("/race_report/{year}/{round}")
async def full_race_report(
    year: str = Path(...),
    round: str = Path(...),
):
    """
    One-shot race report: race metadata + results + qualifying + pitstops.
    All four datasets fetched in parallel.
    """
    import asyncio

    async def _get_results_with_meta():
        data = await ergast._get(f"/{year}/{round}/results")
        races = ergast._mr(data).get("RaceTable", {}).get("Races", [])
        if not races:
            return None, []
        race = races[0]
        race_info = {
            "season": race.get("season"),
            "round": race.get("round"),
            "raceName": race.get("raceName"),
            "date": race.get("date"),
            "time": race.get("time"),
            "Circuit": race.get("Circuit"),
        }
        return race_info, race.get("Results", [])

    race_meta_results, qualifying, pitstops = await asyncio.gather(
        _get_results_with_meta(),
        ergast.get_qualifying_results(year, round),
        ergast.get_pit_stops(year, round),
    )
    race_info, results = race_meta_results

    return {
        "race": race_info,
        "results": results,
        "qualifying": qualifying,
        "pitstops": pitstops,
    }


# ── Lap Evolution ─────────────────────────────────────────────────────────────

@router.get("/lap_evolution/{year}/{round}")
async def lap_evolution(
    year: str = Path(...),
    round: str = Path(...),
):
    """
    All lap times and positions per driver per lap.
    Paginates the Ergast API (which caps at 100 records per page) in parallel
    batches until all lap-timing entries have been retrieved.
    """
    import asyncio

    PAGE_SIZE = 100  # Ergast/Jolpica enforces this cap

    # First page — also reveals the total record count
    first = await ergast._get(f"/{year}/{round}/laps", {"limit": PAGE_SIZE, "offset": 0})
    total = int(ergast._mr(first).get("total", 0))

    # Fetch remaining pages in parallel (batch of 10 at a time to be polite)
    remaining_offsets = list(range(PAGE_SIZE, total, PAGE_SIZE))
    all_pages = [first]
    for batch_start in range(0, len(remaining_offsets), 10):
        batch = remaining_offsets[batch_start:batch_start + 10]
        pages = await asyncio.gather(*[
            ergast._get(f"/{year}/{round}/laps", {"limit": PAGE_SIZE, "offset": off})
            for off in batch
        ])
        all_pages.extend(pages)

    flat: list[dict] = []
    seen: set[tuple] = set()

    for data in all_pages:
        races = ergast._mr(data).get("RaceTable", {}).get("Races", [])
        if not races:
            continue
        for lap_entry in races[0].get("Laps", []):
            lap_num = int(lap_entry.get("number", 0))
            for timing in lap_entry.get("Timings", []):
                driver_id = timing.get("driverId", "")
                key = (lap_num, driver_id)
                if key in seen:
                    continue
                seen.add(key)
                time_str = timing.get("time", "")
                try:
                    parts = time_str.split(":")
                    time_s = float(parts[0]) * 60 + float(parts[1]) if len(parts) == 2 else float(time_str)
                except (ValueError, IndexError):
                    continue
                flat.append({
                    "lap": lap_num,
                    "driverId": driver_id,
                    "position": int(timing.get("position", 0)),
                    "time_s": time_s,
                })

    return {"total": len(flat), "laps": flat}
