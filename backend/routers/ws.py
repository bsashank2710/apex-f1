"""
WebSocket endpoint — streams live race events to connected clients.

Connect at: ws://<host>:8000/ws/race[?api_key=<key>]

Messages are JSON objects with a `type` field:
  { "type": "race_control",  "data": [...] }
  { "type": "intervals",     "data": [...] }
  { "type": "weather",       "data": {...} }
  { "type": "ping" }
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services import openf1
from services.auth import verify_ws_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])

POLL_INTERVAL = 2.0          # seconds between OpenF1 polls
PING_INTERVAL = 30.0         # keepalive ping
MAX_RC_HISTORY = 50          # race control messages to track for dedup


class ConnectionManager:
    def __init__(self):
        self.active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def send(self, ws: WebSocket, payload: dict):
        try:
            await ws.send_text(json.dumps(payload, default=str))
        except Exception:
            self.disconnect(ws)


manager = ConnectionManager()


@router.websocket("/ws/race")
async def race_websocket(websocket: WebSocket):
    """
    Streams live race data. Polls OpenF1 on a 2-second loop and pushes
    deltas (new race control messages, updated intervals, weather changes).
    """
    if not await verify_ws_key(websocket):
        await websocket.close(code=4003, reason="Unauthorized")
        return

    await manager.connect(websocket)
    logger.info(f"WS client connected. Total: {len(manager.active)}")

    seen_rc_dates: set[str] = set()
    last_weather_rainfall: Any = None
    ping_counter = 0

    try:
        while True:
            # Fetch live data concurrently
            try:
                rc_msgs, intervals, weather_list = await asyncio.gather(
                    openf1.get_race_control(session_key="latest"),
                    openf1.get_intervals(session_key="latest"),
                    openf1.get_weather(session_key="latest"),
                    return_exceptions=True,
                )
            except Exception:
                await asyncio.sleep(POLL_INTERVAL)
                continue

            # ── Race control — only push NEW messages ─────────────────────────
            if isinstance(rc_msgs, list) and rc_msgs:
                new_msgs = []
                for msg in rc_msgs[-MAX_RC_HISTORY:]:
                    key = msg.get("date", "") + msg.get("message", "")
                    if key and key not in seen_rc_dates:
                        seen_rc_dates.add(key)
                        new_msgs.append(msg)
                        # Trim seen set to avoid unbounded growth
                        if len(seen_rc_dates) > MAX_RC_HISTORY * 2:
                            seen_rc_dates = set(list(seen_rc_dates)[-MAX_RC_HISTORY:])

                if new_msgs:
                    await manager.send(websocket, {
                        "type": "race_control",
                        "data": new_msgs,
                    })

            # ── Intervals — push every cycle (small payload) ──────────────────
            if isinstance(intervals, list) and intervals:
                await manager.send(websocket, {
                    "type": "intervals",
                    "data": intervals,
                })

            # ── Weather — push only on meaningful change ──────────────────────
            if isinstance(weather_list, list) and weather_list:
                latest_w = weather_list[-1]
                current_rainfall = latest_w.get("rainfall", 0)
                if current_rainfall != last_weather_rainfall:
                    last_weather_rainfall = current_rainfall
                    await manager.send(websocket, {
                        "type": "weather",
                        "data": latest_w,
                    })

            # ── Keepalive ping every ~30s ─────────────────────────────────────
            ping_counter += 1
            if ping_counter * POLL_INTERVAL >= PING_INTERVAL:
                ping_counter = 0
                await manager.send(websocket, {"type": "ping"})

            await asyncio.sleep(POLL_INTERVAL)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WS error: {e}")
    finally:
        manager.disconnect(websocket)
        logger.info(f"WS client disconnected. Total: {len(manager.active)}")
