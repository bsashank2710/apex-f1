"""
Redis caching layer — fail-open.
If Redis is unavailable or REDIS_URL is not set, every call is a no-op and
the real API is used instead. Nothing breaks without Redis.
"""

import json
import os
from typing import Any, Optional

import redis.asyncio as aioredis

_redis: Optional[aioredis.Redis] = None


def _get_redis() -> Optional[aioredis.Redis]:
    global _redis
    if _redis is not None:
        return _redis
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        _redis = aioredis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        return _redis
    except Exception:
        return None


async def get(key: str) -> Optional[Any]:
    """Return cached value or None if missing / Redis unavailable."""
    r = _get_redis()
    if r is None:
        return None
    try:
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def set(key: str, value: Any, ttl: int = 5) -> None:
    """Cache value with TTL in seconds. Silently fails if Redis unavailable."""
    r = _get_redis()
    if r is None:
        return
    try:
        await r.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception:
        pass


async def cached(key: str, ttl: int, fn):
    """
    Decorator-style helper:
        data = await cached("openf1:laps:latest", ttl=5, fn=lambda: openf1.get_laps())
    """
    hit = await get(key)
    if hit is not None:
        return hit
    result = await fn()
    await set(key, result, ttl)
    return result


async def invalidate(pattern: str) -> None:
    """Delete all keys matching a pattern (e.g. 'openf1:*')."""
    r = _get_redis()
    if r is None:
        return
    try:
        keys = await r.keys(pattern)
        if keys:
            await r.delete(*keys)
    except Exception:
        pass


async def close() -> None:
    global _redis
    if _redis:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None
