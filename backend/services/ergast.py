"""
Ergast Motor Racing API client — async, typed, with Redis caching.
Mirrors the Jolpica community endpoint (BASE_URL configurable via env).
"""

import hashlib
import httpx
import os
from typing import Any, Optional
from dotenv import load_dotenv
from services import cache as _cache

load_dotenv()

BASE_URL = os.getenv("ERGAST_BASE_URL", "https://api.jolpi.ca/ergast/f1")

_client: Optional[httpx.AsyncClient] = None

# Historical data changes rarely — cache for 5 minutes by default
_DEFAULT_TTL = 300


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
            headers={"Accept": "application/json"},
        )
    return _client


def _cache_key(path: str, params: dict) -> str:
    raw = path + str(sorted(params.items()))
    return "ergast:" + hashlib.md5(raw.encode()).hexdigest()[:16]


async def _get(path: str, params: dict[str, Any] | None = None, ttl: int = _DEFAULT_TTL) -> dict:
    if not path.endswith(".json"):
        path = path + ".json"
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}
    key = _cache_key(path, clean_params)

    cached = await _cache.get(key)
    if cached is not None:
        return cached

    client = _get_client()
    response = await client.get(path, params=clean_params)
    response.raise_for_status()
    data = response.json()
    await _cache.set(key, data, ttl=ttl)
    return data


def _mr(data: dict) -> dict:
    return data.get("MRData", data)


# ── Schedule ──────────────────────────────────────────────────────────────────

async def get_schedule(year: int | str = "current") -> list[dict]:
    data = await _get(f"/{year}")
    return _mr(data).get("RaceTable", {}).get("Races", [])


async def get_next_race(year: int | str = "current") -> dict | None:
    races = await get_schedule(year)
    from datetime import date
    today = date.today().isoformat()
    upcoming = [r for r in races if r.get("date", "") >= today]
    return upcoming[0] if upcoming else None


# ── Race Results ──────────────────────────────────────────────────────────────

async def get_race_results(
    year: int | str = "current",
    round_: int | str = "last",
) -> list[dict]:
    data = await _get(f"/{year}/{round_}/results")
    races = _mr(data).get("RaceTable", {}).get("Races", [])
    return races[0].get("Results", []) if races else []


async def get_qualifying_results(
    year: int | str = "current",
    round_: int | str = "last",
) -> list[dict]:
    data = await _get(f"/{year}/{round_}/qualifying")
    races = _mr(data).get("RaceTable", {}).get("Races", [])
    return races[0].get("QualifyingResults", []) if races else []


async def get_sprint_results(
    year: int | str = "current",
    round_: int | str = "last",
) -> list[dict]:
    data = await _get(f"/{year}/{round_}/sprint")
    races = _mr(data).get("RaceTable", {}).get("Races", [])
    return races[0].get("SprintResults", []) if races else []


# ── Lap Times & Pit Stops ─────────────────────────────────────────────────────

async def get_lap_times(
    year: int | str = "current",
    round_: int | str = "last",
    lap: int | None = None,
    driver_id: str | None = None,
) -> list[dict]:
    path = f"/{year}/{round_}/laps"
    if lap:
        path += f"/{lap}"
    params: dict[str, Any] = {"limit": 100}
    if driver_id:
        params["driverId"] = driver_id
    data = await _get(path, params)
    races = _mr(data).get("RaceTable", {}).get("Races", [])
    return races[0].get("Laps", []) if races else []


async def get_pit_stops(
    year: int | str = "current",
    round_: int | str = "last",
    stop: int | None = None,
    driver_id: str | None = None,
) -> list[dict]:
    path = f"/{year}/{round_}/pitstops"
    if stop:
        path += f"/{stop}"
    params: dict[str, Any] = {}
    if driver_id:
        params["driverId"] = driver_id
    data = await _get(path, params)
    races = _mr(data).get("RaceTable", {}).get("Races", [])
    return races[0].get("PitStops", []) if races else []


# ── Standings ─────────────────────────────────────────────────────────────────

async def get_driver_standings(
    year: int | str = "current",
    round_: int | str | None = None,
) -> list[dict]:
    path = f"/{year}"
    if round_:
        path += f"/{round_}"
    path += "/driverStandings"
    data = await _get(path, ttl=120)
    standings_lists = _mr(data).get("StandingsTable", {}).get("StandingsLists", [])
    return standings_lists[0].get("DriverStandings", []) if standings_lists else []


async def get_constructor_standings(
    year: int | str = "current",
    round_: int | str | None = None,
) -> list[dict]:
    path = f"/{year}"
    if round_:
        path += f"/{round_}"
    path += "/constructorStandings"
    data = await _get(path, ttl=120)
    standings_lists = _mr(data).get("StandingsTable", {}).get("StandingsLists", [])
    return standings_lists[0].get("ConstructorStandings", []) if standings_lists else []


# ── Drivers & Constructors ────────────────────────────────────────────────────

async def get_drivers(year: int | str = "current") -> list[dict]:
    data = await _get(f"/{year}/drivers")
    return _mr(data).get("DriverTable", {}).get("Drivers", [])


async def get_constructors(year: int | str = "current") -> list[dict]:
    data = await _get(f"/{year}/constructors")
    return _mr(data).get("ConstructorTable", {}).get("Constructors", [])


async def get_driver_info(driver_id: str) -> dict | None:
    data = await _get(f"/drivers/{driver_id}")
    drivers = _mr(data).get("DriverTable", {}).get("Drivers", [])
    return drivers[0] if drivers else None


# ── Circuits ──────────────────────────────────────────────────────────────────

async def get_circuits(year: int | str = "current") -> list[dict]:
    data = await _get(f"/{year}/circuits")
    return _mr(data).get("CircuitTable", {}).get("Circuits", [])


async def get_circuit_results(circuit_id: str, limit: int = 5) -> list[dict]:
    data = await _get(f"/circuits/{circuit_id}/results/1", {"limit": limit})
    return _mr(data).get("RaceTable", {}).get("Races", [])


# ── Cleanup ───────────────────────────────────────────────────────────────────

async def close():
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
