"""Engine selection and adapter health tests."""

from __future__ import annotations

import logging
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from pydantic import ValidationError

from app.adapters import ace_step as ace_step_module
from app.adapters.ace_step import AceStepAdapter, force_handler_dtype, format_keyscale
from app.adapters.registry import AdapterRegistry
from app.config import Settings
from app.errors import InvalidRequestError
from app.schemas import EngineName, GenerateRequest
from tests.helpers import run


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "music_lab_output_dir": tmp_path,
        "music_lab_mode": "simulation",
        "sim_latency_ms": 0,
    }
    values.update(overrides)
    return Settings(**values)


def _fake_torch() -> types.ModuleType:
    torch_module = types.ModuleType("torch")
    for name in ("bfloat16", "float16", "float32"):
        setattr(torch_module, name, f"torch.{name}")
    return torch_module


def test_simulation_selection(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = AdapterRegistry(_settings(tmp_path))
        selection = await registry.select()
        assert selection.mode.value == "simulation"
        assert await selection.adapter.capabilities() == {"generate", "repaint", "cover", "stems"}
        await registry.close()

    run(scenario())


def test_auto_mode_is_no_longer_accepted(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        _settings(tmp_path, music_lab_mode="auto")


def test_ace_step_mode_never_falls_back_to_simulation(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = AdapterRegistry(_settings(tmp_path, music_lab_mode="ace-step", music_lab_allow_no_auth=True))
        selection = await registry.select()
        assert selection.mode is EngineName.ACE_STEP
        assert selection.adapter.engine is EngineName.ACE_STEP
        await registry.close()

    run(scenario())


def test_ace_step_dtype_is_validated(tmp_path: Path) -> None:
    assert _settings(tmp_path, ace_step_dtype="float32").ace_step_dtype == "float32"
    with pytest.raises(ValidationError):
        _settings(tmp_path, ace_step_dtype="float8")


def test_force_handler_dtype_moves_every_component() -> None:
    class FakeComponent:
        def __init__(self) -> None:
            self.dtype = "float16"
            self.calls: list[dict[str, object]] = []

        def to(self, **kwargs: object) -> FakeComponent:
            self.calls.append(kwargs)
            self.dtype = str(kwargs["dtype"])
            return self

    class FakeHandler:
        def __init__(self) -> None:
            self.dtype = "float16"
            self.model = FakeComponent()
            self.model.decoder = FakeComponent()
            self.vae = FakeComponent()
            self.text_encoder = FakeComponent()
            self.silence_latent = FakeComponent()

    fake_torch = SimpleNamespace(bfloat16="bfloat16", float16="float16", float32="float32")
    handler = FakeHandler()

    moved = force_handler_dtype(handler, fake_torch, "bfloat16")

    assert moved == ["model", "decoder", "vae", "text_encoder", "silence_latent"]
    assert handler.dtype == "bfloat16"
    components = (
        handler.model,
        handler.model.decoder,
        handler.vae,
        handler.text_encoder,
        handler.silence_latent,
    )
    for component in components:
        assert component.dtype == "bfloat16"
        assert component.calls == [{"dtype": "bfloat16"}]


def test_ace_step_keyscale_and_caption_mapping(tmp_path: Path) -> None:
    assert format_keyscale("C") == "C major"
    assert format_keyscale("Am") == "A minor"
    assert format_keyscale("F# minor") == "F# minor"
    assert format_keyscale("Db") == "Db major"

    adapter = AceStepAdapter(_settings(tmp_path))
    request = GenerateRequest(
        prompt="dark reggaeton",
        style_tags=["808 bass", "night"],
        bpm=92,
        key="Am",
    )
    assert adapter._build_caption(request) == "dark reggaeton; styles: 808 bass, night"


def test_ace_step_health_does_not_require_weights_when_auto_download(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        ace_step_model_path=tmp_path / "missing-models",
        ace_step_auto_download=True,
        ace_step_device="cpu",
    )
    reasons = AceStepAdapter(settings)._health_reasons()
    assert not any("weights not found" in reason for reason in reasons)


def test_ace_step_dtype_is_validated_and_normalized(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        ace_step_dtype=" BFLOAT16 ",
        ace_step_quantization="",
    )
    assert settings.ace_step_dtype == "bfloat16"
    assert settings.ace_step_quantization is None

    with pytest.raises(ValidationError):
        _settings(tmp_path, ace_step_dtype="fp16")


def _fake_upstream_modules() -> tuple[dict[str, Any], Any, Any]:
    gpu_config = types.ModuleType("acestep.gpu_config")
    memory_utils = types.ModuleType("acestep.core.generation.handler.memory_utils")

    def _unsupported(*_args: Any, **_kwargs: Any) -> bool:
        return False

    gpu_config.cuda_supports_bfloat16 = _unsupported
    memory_utils.cuda_supports_bfloat16 = _unsupported
    return (
        {
            "acestep.gpu_config": gpu_config,
            "acestep.core.generation.handler.memory_utils": memory_utils,
        },
        gpu_config,
        memory_utils,
    )


def test_ace_step_forces_bfloat16_probes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    modules, gpu_config, memory_utils = _fake_upstream_modules()
    monkeypatch.setattr(
        ace_step_module,
        "importlib",
        types.SimpleNamespace(import_module=modules.__getitem__),
    )
    adapter = AceStepAdapter(_settings(tmp_path, ace_step_dtype="bfloat16", ace_step_device="cuda"))

    assert adapter._apply_dtype_policy() == "bfloat16"
    assert gpu_config.cuda_supports_bfloat16() is True
    assert memory_utils.cuda_supports_bfloat16(0) is True


def test_ace_step_forces_float16_probes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    modules, gpu_config, memory_utils = _fake_upstream_modules()
    monkeypatch.setattr(
        ace_step_module,
        "importlib",
        types.SimpleNamespace(import_module=modules.__getitem__),
    )
    adapter = AceStepAdapter(_settings(tmp_path, ace_step_dtype="float16", ace_step_device="cuda"))

    assert adapter._apply_dtype_policy() == "float16"
    assert gpu_config.cuda_supports_bfloat16() is False
    assert memory_utils.cuda_supports_bfloat16() is False


def test_ace_step_load_passes_quantization_and_records_dtype(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    modules, gpu_config, memory_utils = _fake_upstream_modules()
    calls: list[dict[str, Any]] = []

    class FakeHandler:
        dtype = "torch.bfloat16"

        def initialize_service(self, **kwargs: Any) -> tuple[str, bool]:
            calls.append(kwargs)
            return ("ok", True)

    handler_module = types.ModuleType("acestep.handler")
    handler_module.AceStepHandler = FakeHandler
    modules["torch"] = _fake_torch()
    modules["acestep.handler"] = handler_module
    modules["acestep.inference"] = types.ModuleType("acestep.inference")
    monkeypatch.setattr(
        ace_step_module,
        "importlib",
        types.SimpleNamespace(import_module=modules.__getitem__),
    )
    settings = _settings(
        tmp_path,
        ace_step_model_path=tmp_path / "models",
        ace_step_device="cuda",
        ace_step_dtype="bfloat16",
        ace_step_quantization="int8_weight_only",
    )
    adapter = AceStepAdapter(settings)

    with caplog.at_level(logging.INFO, logger=ace_step_module.__name__):
        adapter._load_sync()

    assert adapter._effective_dtype == "bfloat16"
    assert gpu_config.cuda_supports_bfloat16() is True
    assert memory_utils.cuda_supports_bfloat16() is True
    assert calls[0]["quantization"] == "int8_weight_only"
    assert calls[0]["config_path"] == "acestep-v15-turbo"
    assert "[ace_step] dtype forzado: bfloat16" in caplog.text


def test_ace_step_omits_quantization_when_not_configured(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    modules, _gpu_config, _memory_utils = _fake_upstream_modules()
    calls: list[dict[str, Any]] = []

    class FakeHandler:
        dtype = "torch.bfloat16"

        def initialize_service(self, **kwargs: Any) -> tuple[str, bool]:
            calls.append(kwargs)
            return ("ok", True)

    handler_module = types.ModuleType("acestep.handler")
    handler_module.AceStepHandler = FakeHandler
    modules["torch"] = _fake_torch()
    modules["acestep.handler"] = handler_module
    modules["acestep.inference"] = types.ModuleType("acestep.inference")
    monkeypatch.setattr(
        ace_step_module,
        "importlib",
        types.SimpleNamespace(import_module=modules.__getitem__),
    )
    adapter = AceStepAdapter(
        _settings(
            tmp_path,
            ace_step_model_path=tmp_path / "models",
            ace_step_device="cuda",
            ace_step_quantization=None,
        )
    )

    adapter._load_sync()

    assert "quantization" not in calls[0]


def test_ace_step_health_reports_effective_dtype_and_gpu(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    adapter = AceStepAdapter(_settings(tmp_path, ace_step_device="cpu"))
    adapter._effective_dtype = "bfloat16"
    monkeypatch.setattr(
        ace_step_module,
        "gpu_info",
        lambda: {"name": "Tesla T4", "vram_total_mb": 15360, "vram_total_gb": 15.0},
    )

    health = run(adapter.health())
    details = health.details
    assert details["config_path"] == "acestep-v15-turbo"
    assert details["dtype"] == "bfloat16"
    assert details["effective_dtype"] == "bfloat16"
    assert details["offload"] is False
    assert details["use_lm"] is False
    assert details["gpu"]["name"] == "Tesla T4"
    assert details["gpu"]["vram_total_mb"] == 15360


def test_ace_step_phase_times_reads_upstream_costs() -> None:
    result = SimpleNamespace(
        extra_outputs={
            "time_costs": {
                "dit_diffusion_time_cost": 12.3456,
                "dit_vae_decode_time_cost": 3.2,
                "lm_total_time": 1.0,
            }
        }
    )
    assert AceStepAdapter._phase_times(result) == {
        "diffusion": 12.346,
        "decode": 3.2,
        "lm": 1.0,
    }
    assert AceStepAdapter._phase_times(SimpleNamespace(extra_outputs={})) == {
        "diffusion": None,
        "decode": None,
        "lm": None,
    }


def test_ace_step_metadata_includes_reproducibility_fields(tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    class FakeParams:
        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

    class FakeTensor:
        def __init__(self, data: Any) -> None:
            self._data = np.asarray(data, dtype=np.float32)

        def detach(self) -> FakeTensor:
            return self

        def cpu(self) -> FakeTensor:
            return self

        def float(self) -> FakeTensor:
            return self

        def numpy(self) -> Any:
            return self._data

    def generate_music(
        dit: Any, llm: Any, params: Any, config: Any, save_dir: str | None = None
    ) -> Any:
        captured["params"] = params
        captured["save_dir"] = save_dir
        return SimpleNamespace(
            success=True,
            audios=[
                {
                    "tensor": FakeTensor(np.full((1, 4800), 0.1, dtype=np.float32)),
                    "sample_rate": 48000,
                    "params": {"seed": 5},
                }
            ],
            extra_outputs={
                "time_costs": {
                    "dit_diffusion_time_cost": 9.5,
                    "dit_vae_decode_time_cost": 1.25,
                }
            },
        )

    inference = SimpleNamespace(
        GenerationParams=FakeParams,
        GenerationConfig=lambda **kwargs: SimpleNamespace(**kwargs),
        generate_music=generate_music,
    )
    adapter = AceStepAdapter(_settings(tmp_path, ace_step_device="cpu"))
    adapter._inference = inference
    adapter._dit_handler = object()
    adapter._effective_dtype = "bfloat16"
    request = GenerateRequest(prompt="test", duration_s=10.0, seed=9)

    duration_s, metadata = adapter._run_inference(
        "generate", request, tmp_path / "out.wav"
    )

    assert duration_s == pytest.approx(0.1, abs=0.01)
    assert captured["params"].inference_steps == 8
    assert metadata["dtype"] == "bfloat16"
    assert metadata["steps"] == 8
    assert metadata["guidance"] == 7.0
    assert metadata["seed"] == 5
    assert metadata["compute"]["phase_seconds"] == {
        "diffusion": 9.5,
        "decode": 1.25,
        "lm": None,
    }
    assert metadata["compute"]["gpu_seconds_by_phase"] == {
        "diffusion": None,
        "decode": None,
        "lm": None,
    }
    assert metadata["quality_preset"] is None


def test_quality_preset_applies_steps_guidance_and_lm(tmp_path: Path) -> None:
    class FakeParams:
        def __init__(self, **kwargs: Any) -> None:
            self.__dict__.update(kwargs)

    adapter = AceStepAdapter(_settings(tmp_path))
    adapter._inference = SimpleNamespace(GenerationParams=FakeParams)

    sft = adapter._build_params(
        "generate",
        GenerateRequest(prompt="x", duration_s=10.0, quality_preset="sft"),
    )
    assert sft.inference_steps == 50
    assert sft.guidance_scale == 8.0
    assert sft.thinking is False

    turbo_lm = adapter._build_params(
        "generate",
        GenerateRequest(prompt="x", duration_s=10.0, quality_preset="turbo_lm"),
    )
    assert turbo_lm.inference_steps == 8
    assert turbo_lm.thinking is True

    with pytest.raises(InvalidRequestError):
        adapter._build_params(
            "generate",
            GenerateRequest(prompt="x", duration_s=10.0, quality_preset="unknown"),
        )
