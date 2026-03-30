"""
OpenF1 API client — async, typed, with Redis caching (fail-open).
Base URL: https://api.openf1.org/v1

Real-time and elevated rate limits require a Bearer token; see
https://openf1.org/auth.html — set OPENF1_USERNAME + OPENF1_PASSWORD or
OPENF1_ACCESS_TOKEN in the environment (backend only; never expose in the client).
"""

import asyncio
import hashlib
import httpx
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from dotenv import load_dotenv
from services import cache as _cache

load_dotenv()


def is_auth_configured() -> bool:
    """True if env has a static token or username/password for OAuth exchange."""
    if os.getenv("OPENF1_ACCESS_TOKEN", "").strip():
        return True
    return bool(
        os.getenv("OPENF1_USERNAME", "").strip() and os.getenv("OPENF1_PASSWORD", "").strip()
    )


BASE_URL = os.getenv("OPENF1_BASE_URL", "https://api.openf1.org/v1")
TOKEN_URL = os.getenv("OPENF1_TOKEN_URL", "https://api.openf1.org/token")

_client: Optional[httpx.AsyncClient] = None
_log = logging.getLogger("openf1")

_oauth_access_token: Optional[str] = None
_oauth_expires_at: float = 0.0
_oauth_lock = asyncio.Lock()
_auth_warned: bool = False

# TTLs (seconds) per data type — live data is short, session info is longer
_TTL = {
    "car_data": 2,
    "location": 2,       # GPS x/y/z coordinates
    "position": 3,       # Race standing positions (1st, 2nd …)
    "intervals": 3,
    "laps": 5,
    "stints": 10,
    "pit": 10,
    "race_control": 3,
    "weather": 30,
    "drivers": 300,
    "sessions": 60,
    "meetings": 300,
}


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=30.0,
            headers={"Accept": "application/json"},
        )
    return _client


def _log_auth_failure_once() -> None:
    global _auth_warned
    if _auth_warned:
        return
    _auth_warned = True
    _log.warning(
        "OpenF1 returned 401/403. Configure OPENF1_USERNAME + OPENF1_PASSWORD "
        "(token exchange) or OPENF1_ACCESS_TOKEN. See https://openf1.org/auth.html"
    )


async def _fetch_oauth_token(*, force_refresh: bool) -> Optional[str]:
    """
    OAuth2 password grant against TOKEN_URL. Cached until shortly before expiry.
    """
    global _oauth_access_token, _oauth_expires_at
    async with _oauth_lock:
        if force_refresh:
            _oauth_access_token = None
            _oauth_expires_at = 0.0
        elif _oauth_access_token and time.time() < _oauth_expires_at - 30:
            return _oauth_access_token

        user = os.getenv("OPENF1_USERNAME", "").strip()
        pw = os.getenv("OPENF1_PASSWORD", "").strip()
        if not user or not pw:
            return None

        async with httpx.AsyncClient(timeout=30.0) as ac:
            r = await ac.post(
                TOKEN_URL,
                data={"username": user, "password": pw},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if r.status_code != 200:
            _log.debug(
                "OpenF1 token exchange failed: %s %s",
                r.status_code,
                (r.text or "")[:200],
            )
            return None
        try:
            data = r.json()
        except Exception:
            return None
        tok = data.get("access_token")
        if not tok:
            return None
        raw_exp = data.get("expires_in", 3600)
        try:
            exp_sec = int(raw_exp)
        except (TypeError, ValueError):
            exp_sec = 3600
        _oauth_access_token = str(tok)
        _oauth_expires_at = time.time() + max(60, exp_sec)
        return _oauth_access_token


async def _request_headers(*, retry_after_401: bool) -> dict[str, str]:
    h: dict[str, str] = {"Accept": "application/json"}
    if not retry_after_401:
        static = os.getenv("OPENF1_ACCESS_TOKEN", "").strip()
        if static:
            h["Authorization"] = f"Bearer {static}"
            return h
    tok = await _fetch_oauth_token(force_refresh=retry_after_401)
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _cache_key(endpoint: str, params: dict) -> str:
    raw = endpoint + str(sorted(params.items()))
    return "openf1:" + hashlib.md5(raw.encode()).hexdigest()[:16]


async def _get(
    endpoint: str,
    params: dict[str, Any] | None = None,
    ttl_override: int | None = None,
) -> list[dict]:
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}
    resource = endpoint.lstrip("/").split("?")[0]
    ttl = ttl_override if ttl_override is not None else _TTL.get(resource, 10)
    key = _cache_key(endpoint, clean_params)

    cached = await _cache.get(key)
    if cached is not None:
        return cached

    client = _get_client()
    headers = await _request_headers(retry_after_401=False)
    response = await client.get(endpoint, params=clean_params, headers=headers)

    if response.status_code == 401:
        headers2 = await _request_headers(retry_after_401=True)
        response = await client.get(endpoint, params=clean_params, headers=headers2)

    if response.status_code in (401, 403):
        _log_auth_failure_once()
        return []

    # OpenF1 returns 404 or 422 when no data exists for the given params.
    # Return an empty list instead of raising — callers treat [] as "no data".
    if response.status_code in (404, 422, 429, 500):
        return []

    response.raise_for_status()
    data = response.json()

    # OpenF1 also returns {"detail": "No results found."} as a 200 in some cases
    if isinstance(data, dict) and "detail" in data:
        return []

    await _cache.set(key, data, ttl=ttl)
    return data


# ── Sessions & Meetings ───────────────────────────────────────────────────────


def _parse_openf1_dt(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        v = value.replace("Z", "+00:00")
        return datetime.fromisoformat(v)
    except ValueError:
        return None


def _derive_session_status(session: dict) -> str:
    """OpenF1 /sessions rows omit status; infer from the published time window."""
    existing = session.get("status")
    if existing:
        return str(existing)
    start = _parse_openf1_dt(session.get("date_start"))
    end = _parse_openf1_dt(session.get("date_end"))
    if not start or not end:
        return "Unknown"
    now = datetime.now(timezone.utc)
    if now < start:
        return "Scheduled"
    if now > end:
        return "Finished"
    return "Active"


async def get_sessions(
    session_key: int | None = None,
    meeting_key: int | None = None,
    year: int | None = None,
    session_name: str | None = None,
) -> list[dict]:
    return await _get("/sessions", {
        "session_key": session_key,
        "meeting_key": meeting_key,
        "year": year,
        "session_name": session_name,
    })


async def get_latest_session() -> dict:
    # Short TTL: "latest" must roll over quickly when a session starts/ends.
    sessions = await _get("/sessions", {"session_key": "latest"}, ttl_override=15)
    if not sessions:
        return {}
    row = dict(sessions[0])
    row["status"] = _derive_session_status(row)
    return row


async def resolve_map_focus_session() -> dict:
    """
    Pick the OpenF1 session the track map (and live widgets) should bind to.

    OpenF1 ``session_key=latest`` often stays on the *last* session row (e.g. FP1)
    after it ends, so clients that only treat ``date_start..date_end`` as "live"
    stop polling GPS. We instead:

    1. Prefer any **ongoing** session in the same meeting (FP1–3, quali, sprint, race).
    2. Else the **most recently finished** session in that meeting (keep GPS / timing
       working until the next session starts).
    3. Else the **next upcoming** session (map_phase=upcoming — UI can show schedule).
    """
    latest_list = await _get("/sessions", {"session_key": "latest"}, ttl_override=10)
    if not latest_list:
        return {}

    anchor = dict(latest_list[0])
    mk = anchor.get("meeting_key")
    yr = anchor.get("year")

    def _finish(row: dict) -> dict:
        r = dict(row)
        r["status"] = _derive_session_status(r)
        return r

    try:
        mk_i = int(mk)
        yr_i = int(yr)
    except (TypeError, ValueError):
        anchor["map_phase"] = "single"
        return _finish(anchor)

    meeting_sessions = await _get(
        "/sessions",
        {"meeting_key": mk_i, "year": yr_i},
        ttl_override=20,
    )
    if not meeting_sessions:
        anchor["map_phase"] = "single"
        return _finish(anchor)

    now = datetime.now(timezone.utc)

    def _dt(key: str, row: dict) -> datetime | None:
        return _parse_openf1_dt(row.get(key))

    ordered = sorted(
        meeting_sessions,
        key=lambda s: (_dt("date_start", s) or datetime.min.replace(tzinfo=timezone.utc)),
    )

    # 1) Ongoing (any session type)
    for s in ordered:
        st, en = _dt("date_start", s), _dt("date_end", s)
        if st and en and st <= now <= en:
            out = dict(s)
            out["status"] = "Active"
            out["map_phase"] = "live"
            return out

    # 2) Most recently finished
    ended: list[tuple[datetime, dict]] = []
    for s in ordered:
        en = _dt("date_end", s)
        if en and en < now:
            ended.append((en, dict(s)))
    if ended:
        ended.sort(key=lambda x: x[0], reverse=True)
        out = ended[0][1]
        out["status"] = "Finished"
        out["map_phase"] = "recent"
        return out

    # 3) Next upcoming
    for s in ordered:
        st = _dt("date_start", s)
        if st and now < st:
            out = dict(s)
            out["status"] = "Scheduled"
            out["map_phase"] = "upcoming"
            return out

    anchor["map_phase"] = "unknown"
    return _finish(anchor)


async def get_meetings(
    meeting_key: int | None = None,
    year: int | None = None,
    country_name: str | None = None,
) -> list[dict]:
    return await _get("/meetings", {
        "meeting_key": meeting_key,
        "year": year,
        "country_name": country_name,
    })


# ── Drivers ───────────────────────────────────────────────────────────────────

async def get_drivers(
    session_key: int | str = "latest",
    driver_number: int | None = None,
) -> list[dict]:
    return await _get("/drivers", {
        "session_key": session_key,
        "driver_number": driver_number,
    })


# ── Car Data ──────────────────────────────────────────────────────────────────

async def get_car_data(
    session_key: int | str = "latest",
    driver_number: int | None = None,
    speed_gte: int | None = None,
) -> list[dict]:
    params: dict[str, Any] = {
        "session_key": session_key,
        "driver_number": driver_number,
    }
    if speed_gte is not None:
        params["speed>="] = speed_gte
    return await _get("/car_data", params)


# ── GPS Location (x/y/z coordinates per car) ─────────────────────────────────

def _strip_dt(dt: str) -> str:
    """Remove timezone offset and microseconds so OpenF1 accepts the date string."""
    dt = dt.replace("Z", "").replace("+00:00", "")
    return dt.split(".")[0]  # drop microseconds


async def get_location(
    session_key: int | str = "latest",
    driver_number: int | None = None,
    date_gte: str | None = None,
    date_lte: str | None = None,
) -> list[dict]:
    """Return GPS location data (x, y, z) from OpenF1 /location endpoint.

    When date_gte / date_lte are supplied the query string is built manually
    so that the '>' and '<' operators are NOT percent-encoded by httpx (OpenF1
    requires them literally, e.g. 'date>=2024-01-01T00:00:00').
    """
    if date_gte or date_lte:
        # Build the query string manually to preserve '>' and '<' operators
        parts: list[str] = [f"session_key={session_key}"]
        if driver_number is not None:
            parts.append(f"driver_number={driver_number}")
        if date_gte:
            parts.append(f"date>={_strip_dt(date_gte)}")
        if date_lte:
            parts.append(f"date<{_strip_dt(date_lte)}")
        # Pass full URL; _get receives no extra params so httpx won't re-encode
        endpoint = "/location?" + "&".join(parts)
        return await _get(endpoint, None, ttl_override=3600)

    return await _get("/location", {
        "session_key": session_key,
        "driver_number": driver_number,
    })


# ── Race Standing Position (1st, 2nd … per lap) ───────────────────────────────

async def get_position(
    session_key: int | str = "latest",
    driver_number: int | None = None,
) -> list[dict]:
    """Return race standing positions (integer 1–20) from OpenF1 /position endpoint."""
    return await _get("/position", {
        "session_key": session_key,
        "driver_number": driver_number,
    })


# ── Intervals ─────────────────────────────────────────────────────────────────

async def get_intervals(
    session_key: int | str = "latest",
    driver_number: int | None = None,
) -> list[dict]:
    return await _get("/intervals", {
        "session_key": session_key,
        "driver_number": driver_number,
    })


# ── Laps ──────────────────────────────────────────────────────────────────────

async def get_laps(
    session_key: int | str = "latest",
    driver_number: int | None = None,
    lap_number: int | None = None,
) -> list[dict]:
    return await _get("/laps", {
        "session_key": session_key,
        "driver_number": driver_number,
        "lap_number": lap_number,
    })


# ── Stints ────────────────────────────────────────────────────────────────────

async def get_stints(
    session_key: int | str = "latest",
    driver_number: int | None = None,
    compound: str | None = None,
) -> list[dict]:
    return await _get("/stints", {
        "session_key": session_key,
        "driver_number": driver_number,
        "compound": compound,
    })


# ── Pit Stops ─────────────────────────────────────────────────────────────────

async def get_pits(
    session_key: int | str = "latest",
    driver_number: int | None = None,
    lap_number: int | None = None,
) -> list[dict]:
    return await _get("/pit", {
        "session_key": session_key,
        "driver_number": driver_number,
        "lap_number": lap_number,
    })


# ── Race Control ──────────────────────────────────────────────────────────────

async def get_race_control(
    session_key: int | str = "latest",
    flag: str | None = None,
    category: str | None = None,
) -> list[dict]:
    return await _get("/race_control", {
        "session_key": session_key,
        "flag": flag,
        "category": category,
    })


# ── Weather ───────────────────────────────────────────────────────────────────

async def get_weather(
    session_key: int | str = "latest",
) -> list[dict]:
    return await _get("/weather", {"session_key": session_key})


# ── Cleanup ───────────────────────────────────────────────────────────────────

async def close():
    global _client, _oauth_access_token, _oauth_expires_at, _auth_warned
    async with _oauth_lock:
        _oauth_access_token = None
        _oauth_expires_at = 0.0
    _auth_warned = False
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None
