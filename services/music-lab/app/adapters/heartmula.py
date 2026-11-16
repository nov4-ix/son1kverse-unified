"""HeartMuLa + HeartCodec adapter.

The pipeline call is based on the local reference implementation:

* ``from heartlib import HeartMuLaGenPipeline``
* ``HeartMuLaGenPipeline.from_pretrained(ckpt_dir, device={...}, dtype={...})``
* ``pipeline({"lyrics": ..., "tags": ...}, max_audio_length_ms=..., save_path=...)``

All heavy imports happen inside ``load()`` so CPU-only installs boot cleanly.
"""

from __future__ import annotations

import asyncio
import importlib
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np

from app.adapters.base import AudioGeneratorInterface
from app.adapters.runtime import cuda_available, module_available, wants_cuda
from app.audio import read_audio, resample_if_needed, write_audio
from app.config import Settings, get_settings
from app.errors import EngineUnavailableError, JobExecutionError, NotSupportedError
from app.schemas import (
    AdapterHealth,
    CoverRequest,
    EngineName,
    GenerateRequest,
    GenerationResult,
    RepaintRequest,
    StemsRequest,
    StemsResult,
)

_DTYPE_NAMES = {
    "float32": "float32",
    "fp32": "float32",
    "float16": "float16",
    "fp16": "float16",
    "bfloat16": "bfloat16",
    "bf16": "bfloat16",
}


class HeartMuLaAdapter(AudioGeneratorInterface):
    engine = EngineName.HEARTMULA
    supported_methods = frozenset({"generate"})

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._pipeline: Any | None = None
        self._loaded = False

    def _ckpt_paths(self) -> dict[str, Path]:
        root = self._settings.heartmula_ckpt_dir
        version = self._settings.heartmula_version
        return {
            "root": root,
            "mula": root / f"HeartMuLa-oss-{version}",
            "codec": root / "HeartCodec-oss",
            "tokenizer": root / "tokenizer.json",
            "gen_config": root / "gen_config.json",
        }

    def _health_reasons(self) -> list[str]:
        reasons: list[str] = []
        if not module_available("torch"):
            reasons.append("torch is not installed")
        if not module_available(self._settings.heartmula_python_module):
            reasons.append(
                f"python module '{self._settings.heartmula_python_module}' is not installed"
            )
        if wants_cuda(self._settings.heartmula_device):
            if not cuda_available():
                reasons.append(
                    f"CUDA requested via HEARTMULA_DEVICE={self._settings.heartmula_device}"
                )
            if not module_available("bitsandbytes"):
                reasons.append("bitsandbytes is not installed (required for INT8)")
        missing = [
            str(path)
            for name, path in self._ckpt_paths().items()
            if name != "root" and not path.exists()
        ]
        if missing:
            reasons.append("missing checkpoints: " + ", ".join(missing))
        return reasons

    async def health(self) -> AdapterHealth:
        reasons = self._health_reasons()
        return AdapterHealth(
            engine=self.engine,
            ready=not reasons,
            reason="; ".join(reasons) if reasons else None,
            device=self._settings.heartmula_device,
            details={
                "ckpt_dir": str(self._settings.heartmula_ckpt_dir),
                "version": self._settings.heartmula_version,
                "python_module": self._settings.heartmula_python_module,
                "loaded": self._loaded,
            },
        )

    async def load(self) -> None:
        if self._loaded:
            return
        reasons = self._health_reasons()
        if reasons:
            raise EngineUnavailableError(
                "HeartMuLa is not ready",
                details={"reasons": reasons, "engine": self.engine.value},
            )

        # Heavy imports stay here on purpose.
        torch = importlib.import_module("torch")
        heartlib = importlib.import_module(self._settings.heartmula_python_module)
        dtype_name = _DTYPE_NAMES.get(self._settings.heartmula_dtype.lower(), "bfloat16")
        mula_dtype = getattr(torch, dtype_name)
        codec_dtype = torch.float32
        device = torch.device(self._settings.heartmula_device)
        pipeline_cls = heartlib.HeartMuLaGenPipeline
        self._pipeline = pipeline_cls.from_pretrained(
            str(self._settings.heartmula_ckpt_dir),
            device={"mula": device, "codec": device},
            dtype={"mula": mula_dtype, "codec": codec_dtype},
            version=self._settings.heartmula_version,
            lazy_load=self._settings.heartmula_lazy_load,
            load_in_8bit=wants_cuda(self._settings.heartmula_device),
        )
        self._loaded = True

    def _build_tags(self, req: GenerateRequest) -> str:
        parts = [*req.style_tags, f"{req.bpm}bpm", req.key]
        cleaned = [
            str(part).strip().lower().replace(" ", "-")
            for part in parts
            if str(part).strip()
        ]
        return ",".join(cleaned)

    def _run_inference(
        self, req: GenerateRequest, raw_path: Path
    ) -> tuple[np.ndarray, int, dict[str, Any]]:
        if self._pipeline is None:
            raise JobExecutionError("HeartMuLa pipeline is not loaded")
        tags = self._build_tags(req)
        lyrics = (req.lyrics or req.prompt).strip()
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        with _torch_no_grad():
            self._pipeline(
                {"lyrics": lyrics, "tags": tags},
                max_audio_length_ms=int(req.duration_s * 1000),
                save_path=str(raw_path),
                topk=self._settings.heartmula_topk,
                temperature=self._settings.heartmula_temperature,
                cfg_scale=self._settings.heartmula_cfg_scale,
            )
        if not raw_path.exists():
            raise JobExecutionError(
                "HeartMuLa did not write audio",
                details={"path": str(raw_path)},
            )
        audio, sample_rate = read_audio(raw_path)
        raw_path.unlink(missing_ok=True)
        metadata = {
            "model": f"HeartMuLa-oss-{self._settings.heartmula_version}",
            "pipeline": "heartlib.HeartMuLaGenPipeline",
            "tags": tags,
            "lyrics_chars": len(lyrics),
        }
        return audio, sample_rate, metadata

    async def generate(self, req: GenerateRequest) -> GenerationResult:
        await self.load()
        job_id = uuid.uuid4().hex
        job_dir = self._settings.music_lab_output_dir / f"heartmula-{job_id}"
        job_dir.mkdir(parents=True, exist_ok=True)
        raw_path = job_dir / "raw-48k.wav"
        audio, sample_rate, metadata = await asyncio.to_thread(
            self._run_inference, req, raw_path
        )
        audio = resample_if_needed(audio, sample_rate, self._settings.music_lab_sample_rate)
        final_path = job_dir / f"generate.{req.output_format.value}"
        write_audio(final_path, audio, self._settings.music_lab_sample_rate, req.output_format)
        metadata.update(
            {
                "seed": req.seed,
                "requested_duration_s": req.duration_s,
                "output_sample_rate": self._settings.music_lab_sample_rate,
            }
        )
        return GenerationResult(
            job_id=job_id,
            audio_path=str(final_path),
            duration_s=round(audio.shape[1] / self._settings.music_lab_sample_rate, 6),
            sample_rate=self._settings.music_lab_sample_rate,
            engine=self.engine,
            mode=self.engine,
            output_format=req.output_format,
            metadata=metadata,
        )

    async def repaint(self, req: RepaintRequest) -> GenerationResult:
        raise NotSupportedError(
            "HeartMuLa does not support repaint in this build",
            details={"engine": self.engine.value},
        )

    async def cover(self, req: CoverRequest) -> GenerationResult:
        raise NotSupportedError(
            "HeartMuLa does not support cover in this build",
            details={"engine": self.engine.value},
        )

    async def stems(self, req: StemsRequest) -> StemsResult:
        raise NotSupportedError(
            "HeartMuLa does not support stems in this build",
            details={"engine": self.engine.value},
        )

    async def capabilities(self) -> set[str]:
        return set(self.supported_methods)

    async def close(self) -> None:
        pipeline = self._pipeline
        self._pipeline = None
        self._loaded = False
        if pipeline is None:
            return
        unload = getattr(pipeline, "_unload", None)
        if callable(unload):
            try:
                unload()
            except Exception:
                pass
        del pipeline


@contextmanager
def _torch_no_grad() -> Iterator[None]:
    """Import torch lazily and expose its no_grad context manager."""
    torch = importlib.import_module("torch")
    with torch.no_grad():
        yield
