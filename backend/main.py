"""
APEX F1 Race Intelligence — FastAPI backend entry point.
Run with: uvicorn main:app --reload --port 8000
"""

import asyncio
import logging
import os
from datetime import date
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from routers import live, history, telemetry, ai, ws
from services import openf1, ergast, cache
from services.auth import verify_api_key

load_dotenv()

_warmup_log = logging.getLogger("apex.warmup")
_startup_log = logging.getLogger("apex.startup")


async def _warmup_popular_cache() -> None:
    """
    Prime OpenF1 + Ergast + Redis/disk for the current calendar round so the first
    browser load after `npm run dev` is not cold. Set DISABLE_STARTUP_WARMUP=1 to skip.
    """
    if os.getenv("DISABLE_STARTUP_WARMUP", "").lower() in ("1", "true", "yes"):
        return
    try:
        await openf1.resolve_map_focus_session()
        await openf1.get_latest_session()
        races = await ergast.get_schedule("current")
        if not races:
            _warmup_log.info("Warmup: no current schedule")
            return
        today = date.today().isoformat()
        upcoming = [r for r in races if r.get("date", "") >= today]
        pick = upcoming[0] if upcoming else races[-1]
        year = int(pick.get("season") or date.today().year)
        rnd_s = str(pick.get("round", "1"))
        rnd = int(float(rnd_s)) if rnd_s.replace(".", "", 1).isdigit() else 1
        event_name = (pick.get("raceName") or "") or ""

        from routers.telemetry import _CIRCUIT_MAP_TTL_SEC, _get_circuit_map_sync

        data = await asyncio.to_thread(_get_circuit_map_sync, year, rnd, event_name)
        path = data.get("path") or []
        if isinstance(path, list) and len(path) >= 16:
            cache_key = f"telemetry:circuit_map:{year}:{rnd}:{event_name or '_'}"
            await cache.set(cache_key, data, ttl=_CIRCUIT_MAP_TTL_SEC)
            _warmup_log.info("Warmup: circuit_map ready for %s round %s", year, rnd)
        else:
            _warmup_log.warning("Warmup: circuit path short (%s pts) for %s R%s", len(path), year, rnd)

        await asyncio.gather(
            ergast.get_qualifying_results(year, rnd),
            ergast.get_race_results(year, rnd),
            return_exceptions=True,
        )
    except Exception as e:
        _warmup_log.warning("Warmup failed (non-fatal): %s", e)


async def _warmup_last_finished_default() -> None:
    """
    Prime FastF1 + Ergast for the **latest completed GP** (same target as
    GET /history/finished_default_session). The generic warmup above uses the *next*
    calendar round — finished-race mode hits a different round, so we warm both.
    """
    if os.getenv("DISABLE_STARTUP_WARMUP", "").lower() in ("1", "true", "yes"):
        return
    try:
        from routers.history import _last_finished_gp_globally
        from routers.telemetry import _CIRCUIT_MAP_TTL_SEC, _get_circuit_map_sync

        race = await _last_finished_gp_globally()
        if not race:
            _warmup_log.info("Warmup (finished default): no completed GP")
            return
        year = int(race.get("season") or date.today().year)
        rnd_s = str(race.get("round", "1"))
        rnd = int(float(rnd_s)) if rnd_s.replace(".", "", 1).isdigit() else 1
        event_name = (race.get("raceName") or "") or ""

        data = await asyncio.to_thread(_get_circuit_map_sync, year, rnd, event_name)
        path = data.get("path") or []
        if isinstance(path, list) and len(path) >= 16:
            cache_key = f"telemetry:circuit_map:{year}:{rnd}:{event_name or '_'}"
            await cache.set(cache_key, data, ttl=_CIRCUIT_MAP_TTL_SEC)
            _warmup_log.info("Warmup (finished default): circuit_map ready for %s R%s", year, rnd)
        else:
            _warmup_log.warning(
                "Warmup (finished default): circuit path short (%s pts) for %s R%s",
                len(path) if isinstance(path, list) else 0,
                year,
                rnd,
            )

        await asyncio.gather(
            ergast.get_qualifying_results(year, rnd),
            ergast.get_race_results(year, rnd),
            return_exceptions=True,
        )

        # Pre-warm the slow FastF1 paths (drivers / laps / stints) so the first mobile
        # request hits Redis/memory instead of triggering a 60-180 s download.
        from routers.live import _try_fastf1_drivers, _try_fastf1_laps, _try_fastf1_stints
        _warmup_log.info("Warmup (finished default): pre-caching FastF1 drivers/laps/stints for %s R%s …", year, rnd)
        drivers, laps, stints = await asyncio.gather(
            _try_fastf1_drivers(year, rnd, 1),   # kind 1 = Race
            _try_fastf1_laps(year, rnd, 1),
            _try_fastf1_stints(year, rnd, 1),
            return_exceptions=True,
        )
        d_ok = isinstance(drivers, list) and len(drivers) > 0
        l_ok = isinstance(laps, list) and len(laps) > 0
        s_ok = isinstance(stints, list) and len(stints) > 0
        _warmup_log.info(
            "Warmup (finished default): FastF1 ready — drivers=%s laps=%s stints=%s",
            len(drivers) if d_ok else "EMPTY",
            len(laps) if l_ok else "EMPTY",
            len(stints) if s_ok else "EMPTY",
        )
    except Exception as e:
        _warmup_log.warning("Warmup (finished default) failed (non-fatal): %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if openf1.is_auth_configured():
        _startup_log.info("OpenF1: credentials present (token or username/password)")
    else:
        _startup_log.warning(
            "OpenF1: no credentials in env — live timing/maps/tyres stay empty until "
            "OPENF1_USERNAME+OPENF1_PASSWORD or OPENF1_ACCESS_TOKEN is set"
        )
    asyncio.create_task(_warmup_popular_cache())
    asyncio.create_task(_warmup_last_finished_default())
    yield
    # Shutdown — close all shared clients and cache
    await openf1.close()
    await ergast.close()
    await cache.close()


# Global HTTP dependencies — verify_api_key is a no-op when API_KEY env var is unset
app = FastAPI(
    title="APEX F1 Race Intelligence API",
    description=(
        "Real-time and historical F1 data aggregation with AI-powered "
        "predictions. Powers the APEX mobile app for the 2026 season."
    ),
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(verify_api_key)],
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Browsers send Origin: http://localhost:8081 for Expo web. If Cloud Run sets
# ALLOWED_ORIGINS to production URLs only, live/* fetches fail with “No
# Access-Control-Allow-Origin”. Merge common local dev origins unless using "*".
_LOCAL_EXPO_WEB_ORIGINS = (
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:8082",
    "http://127.0.0.1:8082",
    "http://localhost:8083",
    "http://127.0.0.1:8083",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
    "http://localhost:19000",
    "http://127.0.0.1:19000",
)


def _allowed_cors_origins() -> list[str]:
    raw = (os.getenv("ALLOWED_ORIGINS") or "*").strip()
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts or "*" in parts:
        return ["*"]
    merged = list(dict.fromkeys([*parts, *_LOCAL_EXPO_WEB_ORIGINS]))
    return merged


ALLOWED_ORIGINS = _allowed_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(live.router)
app.include_router(history.router)
app.include_router(telemetry.router)
app.include_router(ai.router)
app.include_router(ws.router)   # WebSocket — auth handled inside the handler


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
async def root():
    return {
        "service": "APEX F1 Race Intelligence API",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
        "health_deps": "/health/deps",
        "version": "1.0.0",
    }


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}


@app.get("/health/deps", tags=["health"])
async def health_dependencies():
    """
    Integration probe: OpenF1 session data, Ergast schedule, optional Redis.
    Public (no API key) — use after deploy or locally to see why the app is empty.
    """
    from datetime import date

    y = date.today().year
    openf1_sessions = await openf1.get_sessions(year=y)
    openf1_data_ok = len(openf1_sessions) > 0
    try:
        sched = await ergast.get_schedule(str(y))
        ergast_ok = len(sched) > 0
    except Exception:
        ergast_ok = False

    redis_url_set = bool((os.getenv("REDIS_URL") or "").strip())

    return {
        "status": "ok" if ergast_ok else "degraded",
        "mode": "full_live" if openf1_data_ok else "historical_free",
        "season_year_probed": y,
        "openf1_auth_configured": openf1.is_auth_configured(),
        "openf1_session_rows_for_year": len(openf1_sessions),
        "openf1_data_ok": openf1_data_ok,
        "ergast_ok": ergast_ok,
        "redis_configured": redis_url_set,
        "note": (
            None
            if openf1_data_ok
            else (
                "Live OpenF1 timing off — use Session Picker: Ergast rounds + Race session "
                "for laps/tyre pits (compounds unknown). Optional: add OpenF1 credentials for live."
            )
        ),
    }
