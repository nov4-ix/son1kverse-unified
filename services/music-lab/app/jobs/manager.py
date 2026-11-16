"""In-memory asynchronous job queue for the Music Lab."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from app.adapters.registry import AdapterRegistry, Selection
from app.config import Settings
from app.errors import (
    AudioNotReadyError,
    JobNotFoundError,
    MusicLabError,
    NotSupportedError,
)
from app.mastering.chain import MasteringChain
from app.schemas import (
    CoverRequest,
    EngineName,
    ErrorBody,
    GenerateRequest,
    GenerationResult,
    Job,
    JobStatus,
    OperationName,
    OutputFormat,
    RepaintRequest,
    StemName,
    StemsRequest,
    StemsResult,
)

logger = logging.getLogger(__name__)

JobRequest = GenerateRequest | RepaintRequest | CoverRequest | StemsRequest


class JobManager:
    def __init__(self, settings: Settings, registry: AdapterRegistry) -> None:
        self._settings = settings
        self._registry = registry
        self._jobs: dict[str, Job] = {}
        self._requests: dict[str, JobRequest] = {}
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._semaphore = asyncio.Semaphore(settings.music_lab_max_concurrency)
        self._workers: list[asyncio.Task[None]] = []
        self._started = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        for index in range(self._settings.music_lab_max_concurrency):
            self._workers.append(asyncio.create_task(self._worker(index)))

    async def stop(self) -> None:
        self._started = False
        for _ in self._workers:
            await self._queue.put(None)
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def submit(
        self, operation: OperationName, request: JobRequest
    ) -> Job:
        if not self._started:
            raise RuntimeError("JobManager is not started")
        now = datetime.now(UTC)
        job_id = uuid.uuid4().hex
        job = Job(
            job_id=job_id,
            operation=operation,
            status=JobStatus.QUEUED,
            engine=request.engine,
            mode=None,
            created_at=now,
            updated_at=now,
        )
        async with self._lock:
            self._jobs[job_id] = job
            self._requests[job_id] = request
        await self._queue.put(job_id)
        return job

    def get(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(details={"job_id": job_id})
        return job

    def audio_path(self, job_id: str, stem: StemName | None = None) -> Path:
        job = self.get(job_id)
        if job.status is not JobStatus.SUCCEEDED or job.result is None:
            raise AudioNotReadyError(
                "Job has not succeeded yet",
                details={"job_id": job_id, "status": job.status.value},
            )
        result = job.result
        if isinstance(result, StemsResult):
            if stem is None:
                raise AudioNotReadyError(
                    "Stems jobs need an explicit stem query parameter",
                    details={"job_id": job_id, "stems": sorted(result.stems)},
                )
            raw_path = result.stems.get(stem)
        else:
            raw_path = result.audio_path
        if raw_path is None:
            raise AudioNotReadyError(
                "Requested stem is not part of the result",
                details={"job_id": job_id, "stem": stem},
            )
        path = Path(raw_path)
        if not path.is_file():
            raise AudioNotReadyError(
                "Audio file is missing on disk",
                details={"job_id": job_id, "path": str(path)},
            )
        return path

    async def _worker(self, index: int) -> None:
        logger.debug("Music Lab worker %s started", index)
        while True:
            job_id = await self._queue.get()
            if job_id is None:
                return
            async with self._semaphore:
                await self._execute(job_id)
            self._queue.task_done()

    async def _execute(self, job_id: str) -> None:
        request = self._requests.get(job_id)
        job = self._jobs.get(job_id)
        if request is None or job is None:
            return
        await self._update(job_id, status=JobStatus.RUNNING)
        try:
            selection: Selection = await self._registry.select(request.engine)
            capabilities = await selection.adapter.capabilities()
            if job.operation not in capabilities:
                raise NotSupportedError(
                    f"{selection.mode.value} does not support {job.operation}",
                    details={
                        "engine": selection.mode.value,
                        "operation": job.operation,
                        "supported": sorted(capabilities),
                    },
                )
            await self._update(job_id, engine=selection.mode, mode=selection.mode)

            result = await self._dispatch(selection, job.operation, request)
            result.job_id = job_id
            result.mode = selection.mode
            if selection.fallback_reason:
                result.metadata["fallback_reason"] = selection.fallback_reason
                result.metadata["requested_mode"] = self._settings.music_lab_mode
            if request.master:
                result = self._apply_mastering(result)

            await self._update(
                job_id,
                status=JobStatus.SUCCEEDED,
                result=result,
                engine=result.engine,
                mode=result.mode,
                error=None,
            )
        except MusicLabError as exc:
            logger.warning("Job %s failed: %s", job_id, exc.message)
            await self._update(
                job_id,
                status=JobStatus.FAILED,
                error=ErrorBody(**exc.to_payload()),
            )
        except Exception as exc:
            logger.exception("Job %s crashed", job_id)
            await self._update(
                job_id,
                status=JobStatus.FAILED,
                error=ErrorBody(
                    code="JOB_FAILED",
                    message=str(exc) or exc.__class__.__name__,
                    details={"type": exc.__class__.__name__},
                ),
            )

    async def _dispatch(
        self, selection: Selection, operation: OperationName, request: JobRequest
    ) -> GenerationResult | StemsResult:
        adapter = selection.adapter
        if operation == "generate":
            assert isinstance(request, GenerateRequest)
            return await adapter.generate(request)
        if operation == "repaint":
            assert isinstance(request, RepaintRequest)
            return await adapter.repaint(request)
        if operation == "cover":
            assert isinstance(request, CoverRequest)
            return await adapter.cover(request)
        assert isinstance(request, StemsRequest)
        return await adapter.stems(request)

    def _apply_mastering(
        self, result: GenerationResult | StemsResult
    ) -> GenerationResult | StemsResult:
        chain = MasteringChain(result.sample_rate)
        if isinstance(result, GenerationResult):
            source = Path(result.audio_path)
            target = source.with_name(f"{source.stem}-mastered{source.suffix}")
            _, metrics = chain.master_file(source, target, result.output_format)
            result.audio_path = str(target)
            result.metadata["mastering"] = asdict(metrics)
            return result

        mastered: dict[StemName, str] = {}
        metrics_by_stem: dict[str, dict[str, object]] = {}
        for stem, raw_path in result.stems.items():
            source = Path(raw_path)
            target = source.with_name(f"{source.stem}-mastered{source.suffix}")
            output_format = (
                OutputFormat.MP3 if target.suffix.lower() == ".mp3" else OutputFormat.WAV
            )
            _, metrics = chain.master_file(source, target, output_format)
            mastered[stem] = str(target)
            metrics_by_stem[stem] = asdict(metrics)
        result.stems = mastered
        result.metadata["mastering"] = metrics_by_stem
        return result

    async def _update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        result: GenerationResult | StemsResult | None = None,
        error: ErrorBody | None = None,
        engine: EngineName | None = None,
        mode: EngineName | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            updates: dict[str, object] = {"updated_at": datetime.now(UTC)}
            if status is not None:
                updates["status"] = status
            if result is not None:
                updates["result"] = result
            if error is not None:
                updates["error"] = error
            if engine is not None:
                updates["engine"] = engine
            if mode is not None:
                updates["mode"] = mode
            self._jobs[job_id] = job.model_copy(update=updates)
