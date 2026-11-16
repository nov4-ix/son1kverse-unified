"""Async helpers shared by the test-suite without pytest-asyncio."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx

from app.api import create_app
from app.config import Settings


def run(coro: Any) -> Any:
    return asyncio.run(coro)


@asynccontextmanager
async def make_client(settings: Settings) -> AsyncIterator[tuple[Any, httpx.AsyncClient]]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client


async def submit_and_wait(
    client: httpx.AsyncClient,
    path: str,
    payload: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    response = await client.post(path, json=payload, headers=headers)
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job_response = await client.get(f"/v1/jobs/{job_id}", headers=headers)
        assert job_response.status_code == 200, job_response.text
        job = job_response.json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")
