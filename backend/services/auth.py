"""
API key authentication — optional.
If API_KEY env var is set, all HTTP requests must include the header:
    X-API-Key: <key>
If API_KEY is not set (dev mode), auth is completely skipped.

Health, docs, and OpenAPI paths are always public so probes and /docs work when API_KEY is set.

WebSocket connections pass the key as a query param: ?api_key=<key>
"""

import os
from fastapi import HTTPException, Request, Security, WebSocket, status
from fastapi.security.api_key import APIKeyHeader

API_KEY = os.getenv("API_KEY", "")
_header_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)

_PUBLIC_HTTP_PATHS = frozenset(
    {
        "/",
        "/health",
        "/health/deps",
        "/docs",
        "/openapi.json",
        "/redoc",
    }
)


def _is_public_path(path: str) -> bool:
    if path in _PUBLIC_HTTP_PATHS:
        return True
    if path.startswith("/docs/"):
        return True
    return False


async def verify_api_key(request: Request, key: str = Security(_header_scheme)) -> None:
    """FastAPI dependency — inject into routes or as a global app dependency."""
    if _is_public_path(request.url.path):
        return
    if not API_KEY:
        return  # Dev mode: auth disabled
    if key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-API-Key header",
        )


async def verify_ws_key(websocket: WebSocket) -> bool:
    """
    For WebSocket connections, check ?api_key= query param.
    Returns True if auth passes, False if it fails (caller should close socket).
    """
    if not API_KEY:
        return True
    key = websocket.query_params.get("api_key", "")
    return key == API_KEY
