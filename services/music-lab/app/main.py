"""Music Lab FastAPI entrypoint."""

from __future__ import annotations

from app.api import create_app

app = create_app()

__all__ = ["app", "create_app"]
