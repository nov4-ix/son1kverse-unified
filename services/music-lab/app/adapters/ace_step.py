"""ACE-Step 1.5 adapter.

Heavy imports stay inside ``load()`` so the service can boot on a CPU-only
host without torch or the ACE-Step package. The official inference API could
not be verified from the local reference sources, therefore the call itself
is isolated behind ``_run_inference`` and marked with TODO(verify-api).
"""

from __future__ import annotations

import importlib
from typing import Any

from app.adapters.base import AudioGeneratorInterface
from app.adapters.runtime import cuda_available, module_available, wants_cuda
from app.config import Settings, get_settings
from app.errors import EngineUnavailableError, NotSupportedError
from app.schemas import (
    AdapterHealth,
    CoverRequest,
    EngineName,
    GenerateRequest,
    GenerationParams,
    GenerationResult,
    OperationName,
    RepaintRequest,
    StemsRequest,
    StemsResult,
)


class AceStepAdapter(AudioGeneratorInterface):
    engine = EngineName.ACE_STEP
    supported_methods = frozenset({"generate", "repaint", "cover", "stems"})

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._module: Any | None = None
        self._loaded = False

    def _health_reasons(self) -> list[str]:
        reasons: list[str] = []
        if not module_available("torch"):
            reasons.append("torch is not installed")
        if not module_available(self._settings.ace_step_python_module):
            reasons.append(
                f"python module '{self._settings.ace_step_python_module}' is not installed"
            )
        model_path = self._settings.ace_step_model_path
        if not model_path.is_dir() or not any(model_path.iterdir()):
            reasons.append(f"ACE-Step weights not found at {model_path}")
        if wants_cuda(self._settings.ace_step_device) and not cuda_available():
            reasons.append(f"CUDA requested via ACE_STEP_DEVICE={self._settings.ace_step_device}")
        if not self._settings.ace_step_api_verified:
            reasons.append(
                "inference API unverified (TODO(verify-api)); "
                "set ACE_STEP_API_VERIFIED=true only after implementing it"
            )
        return reasons

    async def health(self) -> AdapterHealth:
        reasons = self._health_reasons()
        return AdapterHealth(
            engine=self.engine,
            ready=not reasons,
            reason="; ".join(reasons) if reasons else None,
            device=self._settings.ace_step_device,
            details={
                "model_path": str(self._settings.ace_step_model_path),
                "python_module": self._settings.ace_step_python_module,
                "dtype": self._settings.ace_step_dtype,
                "offload": self._settings.ace_step_offload,
                "api_verified": self._settings.ace_step_api_verified,
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
        # Heavy imports stay here on purpose.
        importlib.import_module("torch")
        self._module = importlib.import_module(self._settings.ace_step_python_module)
        # TODO(verify-api): build the official ACE-Step 1.5 pipeline here once
        # its public construction API is verified against upstream sources.
        self._loaded = True

    async def _run_inference(
        self, operation: OperationName, req: GenerationParams
    ) -> GenerationResult | StemsResult:
        # TODO(verify-api): replace this guard with the verified ACE-Step 1.5
        # inference calls for generate/repaint/cover/stems. Do not guess method
        # names: confirm them against the official repository first.
        raise NotSupportedError(
            "ACE-Step inference API is not verified in this build",
            details={
                "engine": self.engine.value,
                "operation": operation,
                "prompt": req.prompt,
                "model_path": str(self._settings.ace_step_model_path),
            },
            code="ACE_STEP_API_UNVERIFIED",
        )

    async def generate(self, req: GenerateRequest) -> GenerationResult:
        await self.load()
        result = await self._run_inference("generate", req)
        if not isinstance(result, GenerationResult):
            raise NotSupportedError("ACE-Step returned an invalid result type")
        return result

    async def repaint(self, req: RepaintRequest) -> GenerationResult:
        await self.load()
        result = await self._run_inference("repaint", req)
        if not isinstance(result, GenerationResult):
            raise NotSupportedError("ACE-Step returned an invalid result type")
        return result

    async def cover(self, req: CoverRequest) -> GenerationResult:
        await self.load()
        result = await self._run_inference("cover", req)
        if not isinstance(result, GenerationResult):
            raise NotSupportedError("ACE-Step returned an invalid result type")
        return result

    async def stems(self, req: StemsRequest) -> StemsResult:
        await self.load()
        result = await self._run_inference("stems", req)
        if not isinstance(result, StemsResult):
            raise NotSupportedError("ACE-Step returned an invalid result type")
        return result

    async def capabilities(self) -> set[str]:
        return set(self.supported_methods)

    async def close(self) -> None:
        self._module = None
        self._loaded = False
