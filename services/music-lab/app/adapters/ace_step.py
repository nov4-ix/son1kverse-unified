"""ACE-Step 1.5 adapter.

Verified against the official ``ace-step/ACE-Step-1.5`` repository
(package ``acestep``, version 1.5.0):

* ``from acestep.handler import AceStepHandler``
* ``AceStepHandler().initialize_service(project_root=..., config_path=...,
  device=...)`` auto-downloads the checkpoints from
  ``ACE-Step/Ace-Step1.5`` on Hugging Face into
  ``ACESTEP_CHECKPOINTS_DIR`` when they are missing.
* ``from acestep.inference import GenerationParams, GenerationConfig,
  generate_music``
* ``generate_music(dit_handler, llm_handler, params, config, save_dir=...)``
  returns a ``GenerationResult`` with ``audios[0]["tensor"]`` shaped
  ``(channels, samples)`` at 48 kHz.

Heavy imports stay inside :meth:`AceStepAdapter.load` so the service can boot
on a CPU-only host without torch or the ACE-Step package installed.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

import numpy as np

from app.adapters.base import AudioGeneratorInterface
from app.adapters.runtime import cuda_available, module_available, wants_cuda
from app.audio import (
    ensure_stereo,
    read_audio,
    resample_if_needed,
    resolve_output_file,
    write_audio,
)
from app.config import Settings, get_settings
from app.errors import (
    EngineUnavailableError,
    InvalidRequestError,
    JobExecutionError,
    NotSupportedError,
)
from app.schemas import (
    AdapterHealth,
    CoverRequest,
    EngineName,
    GenerateRequest,
    GenerationParams,
    GenerationResult,
    RepaintRequest,
    StemsRequest,
    StemsResult,
)

_DURATION_MIN_S = 10.0
_DURATION_MAX_S = 600.0
_CAPTION_MAX_CHARS = 512
_KEY_RE = re.compile(r"^\s*([A-Ga-g])([#b♭]?)\s*(.*?)\s*$")


def format_keyscale(key: str) -> str:
    """Convert ``C`` / ``Am`` / ``F# minor`` to ACE-Step's keyscale format."""
    match = _KEY_RE.match(key)
    if match is None:
        return key.strip()
    note = f"{match.group(1).upper()}{match.group(2).replace('♭', 'b')}"
    suffix = match.group(3).strip().lower()
    if not suffix or suffix.startswith("maj"):
        mode = "major"
    elif suffix.startswith("min") or (suffix.startswith("m") and not suffix.startswith("maj")):
        mode = "minor"
    else:
        mode = suffix
    return f"{note} {mode}"


class AceStepAdapter(AudioGeneratorInterface):
    engine = EngineName.ACE_STEP
    supported_methods = frozenset({"generate", "repaint", "cover"})

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._dit_handler: Any | None = None
        self._llm_handler: Any | None = None
        self._inference: Any | None = None
        self._loaded = False

    @property
    def _checkpoints_dir(self) -> Path:
        root = self._settings.ace_step_model_path
        nested = root / "checkpoints"
        if nested.is_dir() and any(nested.glob("acestep-v15-*")):
            return nested
        return root

    def _weights_present(self) -> bool:
        root = self._checkpoints_dir
        model_dir = root / self._settings.ace_step_config_path
        if not model_dir.is_dir() or not any(model_dir.iterdir()):
            return False
        return (root / "vae").is_dir()

    def _health_reasons(self) -> list[str]:
        reasons: list[str] = []
        if not module_available("torch"):
            reasons.append("torch is not installed")
        if not module_available(self._settings.ace_step_python_module):
            reasons.append(
                f"python module '{self._settings.ace_step_python_module}' is not installed"
            )
        if not self._settings.ace_step_auto_download and not self._weights_present():
            reasons.append(f"ACE-Step weights not found at {self._checkpoints_dir}")
        if wants_cuda(self._settings.ace_step_device) and not cuda_available():
            reasons.append(f"CUDA requested via ACE_STEP_DEVICE={self._settings.ace_step_device}")
        return reasons

    async def health(self) -> AdapterHealth:
        reasons = self._health_reasons()
        return AdapterHealth(
            engine=self.engine,
            ready=not reasons,
            reason="; ".join(reasons) if reasons else None,
            device=self._settings.ace_step_device,
            details={
                "checkpoints_dir": str(self._checkpoints_dir),
                "config_path": self._settings.ace_step_config_path,
                "python_module": self._settings.ace_step_python_module,
                "auto_download": self._settings.ace_step_auto_download,
                "use_lm": self._settings.ace_step_use_lm,
                "dtype": self._settings.ace_step_dtype,
                "offload": self._settings.ace_step_offload,
                "loaded": self._loaded,
            },
        )

    async def load(self) -> None:
        if self._loaded:
            return
        reasons = self._health_reasons()
        if reasons:
            raise EngineUnavailableError(
                "ACE-Step is not ready",
                details={"reasons": reasons, "engine": self.engine.value},
            )
        await asyncio.to_thread(self._load_sync)

    def _load_sync(self) -> None:
        # Heavy imports stay here on purpose.
        importlib.import_module("torch")
        self._checkpoints_dir.mkdir(parents=True, exist_ok=True)
        # The official loader reads this variable first (see acestep.model_downloader).
        os.environ["ACESTEP_CHECKPOINTS_DIR"] = str(self._checkpoints_dir)

        handler_module = importlib.import_module("acestep.handler")
        inference_module = importlib.import_module("acestep.inference")

        dit_handler = handler_module.AceStepHandler()
        status, ok = dit_handler.initialize_service(
            project_root=str(self._checkpoints_dir),
            config_path=self._settings.ace_step_config_path,
            device=self._settings.ace_step_device,
            offload_to_cpu=self._settings.ace_step_offload,
            offload_dit_to_cpu=self._settings.ace_step_offload,
            prefer_source=self._settings.ace_step_download_source,
        )
        if not ok:
            raise EngineUnavailableError(
                "ACE-Step initialization failed",
                details={
                    "status": status,
                    "checkpoints_dir": str(self._checkpoints_dir),
                    "config_path": self._settings.ace_step_config_path,
                },
            )

        llm_handler = None
        if self._settings.ace_step_use_lm:
            llm_module = importlib.import_module("acestep.llm_inference")
            candidate = llm_module.LLMHandler()
            llm_status, llm_ok = candidate.initialize(
                checkpoint_dir=str(self._checkpoints_dir),
                lm_model_path=self._settings.ace_step_lm_model,
                backend=self._settings.ace_step_lm_backend,
                device=self._settings.ace_step_device,
                offload_to_cpu=self._settings.ace_step_offload,
            )
            if not llm_ok:
                raise EngineUnavailableError(
                    "ACE-Step 5Hz LM initialization failed",
                    details={"status": llm_status, "lm_model": self._settings.ace_step_lm_model},
                )
            llm_handler = candidate

        self._inference = inference_module
        self._dit_handler = dit_handler
        self._llm_handler = llm_handler
        self._loaded = True

    def _build_caption(self, req: GenerationParams) -> str:
        tags = [str(tag).strip() for tag in req.style_tags if str(tag).strip()]
        caption = req.prompt.strip()
        if tags:
            caption = f"{caption}; styles: {', '.join(tags)}"
        return caption[:_CAPTION_MAX_CHARS].rstrip()

    def _build_params(
        self,
        operation: str,
        req: GenerationParams,
        source_path: Path | None = None,
    ) -> Any:
        if self._inference is None:
            raise JobExecutionError("ACE-Step pipeline is not loaded")
        inference = self._inference
        use_lm = self._settings.ace_step_use_lm
        lyrics = (req.lyrics or "").strip()
        instrumental = not lyrics or lyrics.lower() == "[instrumental]"
        if not lyrics:
            lyrics = "[Instrumental]"
        duration = max(_DURATION_MIN_S, min(_DURATION_MAX_S, float(req.duration_s)))
        task_type = {
            "generate": "text2music",
            "repaint": "repaint",
            "cover": "cover",
        }[operation]

        return inference.GenerationParams(
            task_type=task_type,
            caption=self._build_caption(req),
            lyrics=lyrics,
            instrumental=instrumental,
            vocal_language=self._settings.ace_step_vocal_language,
            bpm=int(req.bpm),
            keyscale=format_keyscale(req.key),
            duration=-1.0 if source_path is not None else duration,
            seed=int(req.seed),
            inference_steps=self._settings.ace_step_inference_steps,
            guidance_scale=self._settings.ace_step_guidance_scale,
            shift=self._settings.ace_step_shift,
            thinking=use_lm,
            use_cot_metas=use_lm,
            use_cot_caption=use_lm,
            use_cot_language=use_lm,
            src_audio=str(source_path) if source_path is not None else None,
            repainting_start=float(getattr(req, "start_s", 0.0)),
            repainting_end=float(getattr(req, "end_s", -1.0)),
        )

    def _build_config(self, req: GenerationParams) -> Any:
        if self._inference is None:
            raise JobExecutionError("ACE-Step pipeline is not loaded")
        return self._inference.GenerationConfig(
            batch_size=1,
            use_random_seed=False,
            seeds=[int(req.seed)],
            audio_format="wav",
        )

    def _run_inference(
        self,
        operation: str,
        req: GenerationParams,
        output_path: Path,
        source_path: Path | None = None,
    ) -> tuple[float, dict[str, Any]]:
        """Run the official pipeline synchronously and write ``output_path``."""
        if self._dit_handler is None or self._inference is None:
            raise JobExecutionError("ACE-Step pipeline is not loaded")

        params = self._build_params(operation, req, source_path)
        if operation == "repaint" and source_path is not None:
            source_audio, source_sr = read_audio(source_path)
            source_duration = source_audio.shape[1] / source_sr
            start_s = float(getattr(req, "start_s", 0.0))
            end_s = float(getattr(req, "end_s", 0.0))
            if start_s >= source_duration:
                raise InvalidRequestError(
                    "start_s is outside the source audio",
                    details={"start_s": start_s, "duration_s": source_duration},
                )
            params.repainting_start = start_s
            params.repainting_end = min(end_s, source_duration)
        config = self._build_config(req)

        raw_dir = output_path.parent / "ace-step-raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        try:
            result = self._inference.generate_music(
                self._dit_handler,
                self._llm_handler,
                params,
                config,
                save_dir=str(raw_dir),
            )
            if not result.success:
                raise JobExecutionError(
                    "ACE-Step generation failed",
                    details={
                        "engine": self.engine.value,
                        "operation": operation,
                        "error": result.error,
                        "status_message": result.status_message,
                    },
                )
            if not result.audios:
                raise JobExecutionError(
                    "ACE-Step returned no audio",
                    details={"engine": self.engine.value, "operation": operation},
                )

            audio = result.audios[0]
            native_sr = int(audio.get("sample_rate") or 48000)
            tensor = audio.get("tensor")
            raw_path = audio.get("path")
            if tensor is not None:
                array = tensor.detach().cpu().float().numpy()
            elif raw_path:
                array, native_sr = read_audio(Path(raw_path))
            else:
                raise JobExecutionError(
                    "ACE-Step audio payload is empty",
                    details={"engine": self.engine.value, "operation": operation},
                )

            array = ensure_stereo(np.asarray(array, dtype=np.float32))
            target_sr = self._settings.music_lab_sample_rate
            array = resample_if_needed(array, native_sr, target_sr)
            write_audio(output_path, array, target_sr, req.output_format)
            duration_s = round(array.shape[1] / target_sr, 6)
        finally:
            shutil.rmtree(raw_dir, ignore_errors=True)

        audio_params = audio.get("params") or {}
        metadata = {
            "model": self._settings.ace_step_config_path,
            "pipeline": "acestep.inference.generate_music",
            "task_type": params.task_type,
            "operation": operation,
            "caption": params.caption,
            "keyscale": params.keyscale,
            "bpm": params.bpm,
            "seed": audio_params.get("seed", req.seed),
            "vocal_language": params.vocal_language,
            "thinking": params.thinking,
            "inference_steps": params.inference_steps,
            "shift": params.shift,
            "native_sample_rate": native_sr,
            "output_sample_rate": self._settings.music_lab_sample_rate,
            "requested_duration_s": req.duration_s,
        }
        if operation == "repaint":
            metadata["repainting_start"] = params.repainting_start
            metadata["repainting_end"] = params.repainting_end
        if source_path is not None:
            metadata["source_audio_path"] = str(source_path)
        return duration_s, metadata

    async def _execute(
        self,
        operation: str,
        req: GenerationParams,
        source_path: Path | None = None,
    ) -> GenerationResult:
        await self.load()
        job_id = uuid.uuid4().hex
        job_dir = self._settings.music_lab_output_dir / f"ace-step-{job_id}"
        job_dir.mkdir(parents=True, exist_ok=True)
        output_path = job_dir / f"{operation}.{req.output_format.value}"
        duration_s, metadata = await asyncio.to_thread(
            self._run_inference, operation, req, output_path, source_path
        )
        return GenerationResult(
            job_id=job_id,
            audio_path=str(output_path),
            duration_s=duration_s,
            sample_rate=self._settings.music_lab_sample_rate,
            engine=self.engine,
            mode=self.engine,
            output_format=req.output_format,
            metadata=metadata,
        )

    def _resolve_source(self, raw_path: str) -> Path:
        return resolve_output_file(raw_path, self._settings.music_lab_output_dir)

    async def generate(self, req: GenerateRequest) -> GenerationResult:
        return await self._execute("generate", req)

    async def repaint(self, req: RepaintRequest) -> GenerationResult:
        source = self._resolve_source(req.source_audio_path)
        return await self._execute("repaint", req, source)

    async def cover(self, req: CoverRequest) -> GenerationResult:
        source = self._resolve_source(req.source_audio_path)
        return await self._execute("cover", req, source)

    async def stems(self, req: StemsRequest) -> StemsResult:
        raise NotSupportedError(
            "ACE-Step does not expose drums/bass/other stem splitting in this build",
            details={"engine": self.engine.value},
        )

    async def capabilities(self) -> set[str]:
        return set(self.supported_methods)

    async def close(self) -> None:
        handler = self._dit_handler
        self._dit_handler = None
        self._llm_handler = None
        self._inference = None
        self._loaded = False
        if handler is None:
            return
        for attr in ("model", "vae", "text_encoder", "text_tokenizer", "silence_latent"):
            if hasattr(handler, attr):
                try:
                    setattr(handler, attr, None)
                except Exception:
                    pass
        del handler
