"""FastAPI application and HTTP routes for the Music Lab."""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.adapters.registry import AdapterRegistry
from app.config import Settings, get_settings
from app.errors import MusicLabError, UnauthorizedError
from app.jobs.manager import JobManager
from app.schemas import (
    AdapterHealth,
    Capabilities,
    CoverRequest,
    EngineName,
    GenerateRequest,
    Job,
    JobAccepted,
    JobStatus,
    OutputFormat,
    RepaintRequest,
    ServiceHealth,
    StemName,
    StemsRequest,
)


async def require_api_key(
    request: Request,
    x_api_key: Annotated[str | None, Header(alias="x-api-key")] = None,
) -> None:
    expected = request.app.state.settings.music_lab_api_key
    if expected and (x_api_key is None or not hmac.compare_digest(x_api_key, expected)):
        raise UnauthorizedError()


def _accepted(job_id: str) -> JobAccepted:
    return JobAccepted(
        job_id=job_id,
        status=JobStatus.QUEUED,
        status_url=f"/v1/jobs/{job_id}",
    )


def _media_type(path_suffix: str) -> str:
    return "audio/mpeg" if path_suffix.lower() == ".mp3" else "audio/wav"


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()
    registry = AdapterRegistry(resolved)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        resolved.ensure_output_dir()
        manager = JobManager(resolved, registry)
        await manager.start()
        app.state.manager = manager
        try:
            yield
        finally:
            await manager.stop()
            await registry.close()

    app = FastAPI(
        title=resolved.service_name,
        version=resolved.service_version,
        description="CPU-first audio generation service. No external generation APIs.",
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.state.registry = registry

    @app.exception_handler(MusicLabError)
    async def music_lab_error(_: Request, exc: MusicLabError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "INVALID_REQUEST",
                "message": "Request validation failed",
                "details": {"errors": jsonable_encoder(exc.errors())},
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": code,
                "message": str(exc.detail),
                "details": {},
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "details": {"type": exc.__class__.__name__},
            },
        )

    @app.get("/health", response_model=ServiceHealth, tags=["system"])
    async def health() -> ServiceHealth:
        snapshot = await registry.health_snapshot()
        mode = resolved.music_lab_mode
        selected: AdapterHealth = snapshot[EngineName(mode)]
        ready = selected.ready
        return ServiceHealth(
            status="ok" if ready else "degraded",
            service=resolved.service_name,
            version=resolved.service_version,
            mode=mode,
            engine=selected if ready else None,
            reason=None if ready else selected.reason or "engine not ready",
        )

    @app.get("/v1/capabilities", response_model=Capabilities, tags=["system"])
    async def capabilities() -> Capabilities:
        methods: set[str] = set()
        for engine in registry.engines():
            methods.update(await registry.get(engine).capabilities())
        active_methods: set[str] = set()
        try:
            selection = await registry.select()
        except MusicLabError:
            active = None
        else:
            active = selection.mode
            active_methods = await selection.adapter.capabilities()
        return Capabilities(
            service=resolved.service_name,
            default_mode=resolved.music_lab_mode,
            active_engine=active,
            modes=registry.modes(),
            engines=registry.engines(),
            methods=sorted(methods),
            active_methods=sorted(active_methods),
            output_formats=[OutputFormat.WAV, OutputFormat.MP3],
            max_concurrency=resolved.music_lab_max_concurrency,
        )

    @app.post(
        "/v1/generate",
        response_model=JobAccepted,
        status_code=202,
        dependencies=[Depends(require_api_key)],
        tags=["generation"],
    )
    async def generate(body: GenerateRequest, request: Request) -> JobAccepted:
        job = await request.app.state.manager.submit("generate", body)
        return _accepted(job.job_id)

    @app.post(
        "/v1/repaint",
        response_model=JobAccepted,
        status_code=202,
        dependencies=[Depends(require_api_key)],
        tags=["generation"],
    )
    async def repaint(body: RepaintRequest, request: Request) -> JobAccepted:
        job = await request.app.state.manager.submit("repaint", body)
        return _accepted(job.job_id)

    @app.post(
        "/v1/cover",
        response_model=JobAccepted,
        status_code=202,
        dependencies=[Depends(require_api_key)],
        tags=["generation"],
    )
    async def cover(body: CoverRequest, request: Request) -> JobAccepted:
        job = await request.app.state.manager.submit("cover", body)
        return _accepted(job.job_id)

    @app.post(
        "/v1/stems",
        response_model=JobAccepted,
        status_code=202,
        dependencies=[Depends(require_api_key)],
        tags=["generation"],
    )
    async def stems(body: StemsRequest, request: Request) -> JobAccepted:
        job = await request.app.state.manager.submit("stems", body)
        return _accepted(job.job_id)

    @app.get(
        "/v1/jobs/{job_id}",
        response_model=Job,
        dependencies=[Depends(require_api_key)],
        tags=["jobs"],
    )
    async def get_job(job_id: str, request: Request) -> Job:
        return request.app.state.manager.get(job_id)

    @app.get(
        "/v1/jobs/{job_id}/audio",
        response_class=FileResponse,
        dependencies=[Depends(require_api_key)],
        tags=["jobs"],
    )
    async def get_job_audio(
        job_id: str,
        request: Request,
        stem: Annotated[StemName | None, Query()] = None,
    ) -> FileResponse:
        path = request.app.state.manager.audio_path(job_id, stem)
        return FileResponse(path, media_type=_media_type(path.suffix), filename=path.name)

    return app


__all__ = ["create_app", "require_api_key"]