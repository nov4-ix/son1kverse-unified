"""In-memory asynchronous job queue for the Music Lab."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.adapters.registry import AdapterRegistry, Selection
from app.adapters.runtime import gpu_info
from app.audio import read_audio, resample_if_needed
from app.config import QUALITY_PRESETS, Settings, get_quality_preset
from app.errors import (
    AudioNotReadyError,
    InvalidRequestError,
    JobNotFoundError,
    MusicLabError,
    NotSupportedError,
)
from app.ham import HarmonicAligner
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

# HAM analyzes a bounded window so long tracks do not blow up the FFT memory.
_HAM_MAX_ANALYSIS_S = 60.0


class JobManager:
    def __init__(self, settings: Settings, registry: AdapterRegistry) -> None:
        self._settings = settings
        self._registry = registry
        self._jobs: dict[str, Job] = {}
        self._requests: dict[str, JobRequest] = {}
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._semaphore = asyncio.Semaphore(settings.music_lab_max_concurrency)
        self._workers: list[asyncio.Task[None]] = []
        self._cleanup_task: asyncio.Task[None] | None = None
        self._started = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        for index in range(self._settings.music_lab_max_concurrency):
            self._workers.append(asyncio.create_task(self._worker(index)))
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self) -> None:
        self._started = False
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
            self._cleanup_task = None
        for _ in self._workers:
            await self._queue.put(None)
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def _cleanup_loop(self) -> None:
        interval = self._settings.music_lab_job_cleanup_interval_s
        while True:
            await asyncio.sleep(interval)
            try:
                await self.cleanup()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Job cleanup failed")

    async def cleanup(self) -> int:
        """Expira jobs por TTL y aplica el tope máximo.

        Devuelve cuántos jobs se eliminaron. Los audios asociados se borran
        best-effort solo si viven dentro de ``music_lab_output_dir``.
        """
        removed: list[Job] = []
        ttl = timedelta(hours=self._settings.music_lab_job_ttl_hours)
        now = datetime.now(UTC)
        async with self._lock:
            if ttl > timedelta(0):
                for job_id, job in list(self._jobs.items()):
                    if now - job.updated_at >= ttl:
                        removed.append(self._jobs.pop(job_id))
                        self._requests.pop(job_id, None)
            overflow = len(self._jobs) - self._settings.music_lab_max_jobs
            if overflow > 0:
                by_age = sorted(
                    (
                        (job.created_at, job_id, job)
                        for job_id, job in self._jobs.items()
                    ),
                    key=lambda item: item[0],
                )
                terminal = [
                    item for item in by_age
                    if item[2].status in (JobStatus.SUCCEEDED, JobStatus.FAILED)
                ]
                active = [item for item in by_age if item not in terminal]
                candidates = terminal + active
                for _, job_id, _job in candidates[:overflow]:
                    if job_id in self._jobs:
                        removed.append(self._jobs.pop(job_id))
                        self._requests.pop(job_id, None)

        for job in removed:
            self._delete_job_files(job)
        if removed:
            logger.info(
                "Cleaned %s Music Lab job(s); %s remain",
                len(removed),
                len(self._jobs),
            )
        return len(removed)

    def _delete_job_files(self, job: Job) -> None:
        result = job.result
        if result is None:
            return
        if isinstance(result, StemsResult):
            raw_paths = list(result.stems.values())
        else:
            raw_paths = [result.audio_path]
        root = self._settings.music_lab_output_dir.resolve()
        for raw_path in raw_paths:
            try:
                path = Path(raw_path).resolve()
                if path.is_relative_to(root) and path.is_file():
                    path.unlink()
            except OSError:
                logger.warning("Could not delete audio file %s", raw_path, exc_info=True)

    def _validate_quality_preset(self, request: JobRequest) -> None:
        name = request.quality_preset
        if name is None:
            return
        if self._settings.music_lab_mode == "simulation" and request.engine != EngineName.ACE_STEP:
            return
        try:
            preset = get_quality_preset(name)
        except KeyError as exc:
            raise InvalidRequestError(
                str(exc),
                details={"available_presets": sorted(QUALITY_PRESETS)},
            ) from exc
        if preset.config_path != self._settings.ace_step_config_path:
            raise InvalidRequestError(
                f"Preset '{name}' requires ACE_STEP_CONFIG_PATH={preset.config_path}",
                details={
                    "quality_preset": name,
                    "required_config_path": preset.config_path,
                    "loaded_config_path": self._settings.ace_step_config_path,
                },
            )
        if preset.use_lm and not self._settings.ace_step_use_lm:
            raise InvalidRequestError(
                f"Preset '{name}' requires ACE_STEP_USE_LM=true",
                details={"quality_preset": name},
            )
        if preset.min_vram_gb > 0:
            info = gpu_info()
            available = float(info["vram_total_gb"]) if info is not None else None
            if available is None or available < preset.min_vram_gb:
                raise InvalidRequestError(
                    f"Preset '{name}' requires at least {preset.min_vram_gb:g} GB of VRAM",
                    details={
                        "quality_preset": name,
                        "required_vram_gb": preset.min_vram_gb,
                        "available_vram_gb": available,
                        "gpu": info,
                    },
                )

    async def submit(
        self, operation: OperationName, request: JobRequest
    ) -> Job:
        if not self._started:
            raise RuntimeError("JobManager is not started")
        self._validate_quality_preset(request)
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
            result = await self._apply_ham(result)
            if request.master:
                result = await asyncio.to_thread(self._apply_mastering, result)

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

    async def _apply_ham(
        self, result: GenerationResult | StemsResult
    ) -> GenerationResult | StemsResult:
        if not isinstance(result, GenerationResult):
            return result
        analysis = await asyncio.to_thread(
            self._run_ham, Path(result.audio_path), result.sample_rate
        )
        result.metadata["ham"] = analysis
        return result

    def _run_ham(self, path: Path, sample_rate: int) -> dict[str, object]:
        audio, actual_sample_rate = read_audio(path)
        if actual_sample_rate != sample_rate:
            audio = resample_if_needed(audio, actual_sample_rate, sample_rate)
        max_samples = int(_HAM_MAX_ANALYSIS_S * sample_rate)
        analyzed_s = audio.shape[1] / sample_rate
        if audio.shape[1] > max_samples:
            start = (audio.shape[1] - max_samples) // 2
            audio = audio[:, start : start + max_samples]
            analyzed_s = max_samples / sample_rate
        analysis = HarmonicAligner(sample_rate).analyze(audio)
        return {
            "analyzed_s": round(analyzed_s, 6),
            "detected_key": f"{analysis.key.key_name} {analysis.key.mode}",
            "detected_key_index": analysis.key.key_index,
            "key_confidence": round(analysis.key.confidence, 6),
            "detected_bpm": round(analysis.bpm, 2),
            "bpm_confidence": round(analysis.bpm_confidence, 6),
            "rms": round(analysis.rms, 6),
            "spectral": {
                "centroid_hz": round(analysis.spectral.centroid_hz, 2),
                "bandwidth_hz": round(analysis.spectral.bandwidth_hz, 2),
                "rolloff_hz": round(analysis.spectral.rolloff_hz, 2),
                "flatness": round(analysis.spectral.flatness, 6),
            },
        }

    def _apply_mastering(
        self, result: GenerationResult | StemsResult
    ) -> GenerationResult | StemsResult:
        started_at = time.perf_counter()
        chain = MasteringChain(result.sample_rate)
        if isinstance(result, GenerationResult):
            source = Path(result.audio_path)
            target = source.with_name(f"{source.stem}-mastered{source.suffix}")
            _, metrics = chain.master_file(source, target, result.output_format)
            result.audio_path = str(target)
            result.metadata["mastering"] = asdict(metrics)
            self._record_mastering_time(result, time.perf_counter() - started_at)
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
        self._record_mastering_time(result, time.perf_counter() - started_at)
        return result

    @staticmethod
    def _record_mastering_time(
        result: GenerationResult | StemsResult, seconds: float
    ) -> None:
        compute = result.metadata.get("compute")
        if not isinstance(compute, dict):
            return
        elapsed = round(seconds, 3)
        phase_seconds = compute.setdefault("phase_seconds", {})
        gpu_seconds = compute.setdefault("gpu_seconds_by_phase", {})
        if isinstance(phase_seconds, dict):
            phase_seconds["mastering"] = elapsed
        if isinstance(gpu_seconds, dict):
            gpu_seconds["mastering"] = 0.0

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
            job = self._jobs.get(job_id)
            if job is None:
                return
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
