"""Engine selection and adapter health tests."""

from __future__ import annotations

from pathlib import Path

from app.adapters.registry import AdapterRegistry
from app.config import Settings
from tests.helpers import run


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "music_lab_output_dir": tmp_path,
        "music_lab_mode": "simulation",
        "sim_latency_ms": 0,
    }
    values.update(overrides)
    return Settings(**values)


def test_simulation_selection(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = AdapterRegistry(_settings(tmp_path))
        selection = await registry.select()
        assert selection.mode.value == "simulation"
        assert await selection.adapter.capabilities() == {"generate", "repaint", "cover", "stems"}
        await registry.close()

    run(scenario())


def test_auto_without_gpu_is_explicit(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = AdapterRegistry(_settings(tmp_path, music_lab_mode="auto"))
        try:
            await registry.select()
        except Exception as exc:
            assert exc.__class__.__name__ == "EngineUnavailableError"
            assert exc.to_payload()["code"] == "ENGINE_UNAVAILABLE"
        else:
            raise AssertionError("auto mode should fail without a GPU engine")
        await registry.close()

    run(scenario())


def test_auto_fallback_is_opt_in(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = AdapterRegistry(
            _settings(
                tmp_path,
                music_lab_mode="auto",
                music_lab_allow_sim_fallback=True,
            )
        )
        selection = await registry.select()
        assert selection.mode.value == "simulation"
        assert selection.fallback_reason is not None
        assert "ace-step" in selection.fallback_reason
        await registry.close()

    run(scenario())
