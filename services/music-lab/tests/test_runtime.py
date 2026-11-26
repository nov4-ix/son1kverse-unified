"""Runtime probe tests."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.adapters import runtime


def test_gpu_info_parses_nvidia_smi(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime.gpu_info.cache_clear()
    monkeypatch.setattr(runtime.shutil, "which", lambda _name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(
        runtime.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0, stdout="Tesla T4, 15360\n"
        ),
    )

    assert runtime.gpu_info() == {
        "name": "Tesla T4",
        "vram_total_mb": 15360,
        "vram_total_gb": 15.0,
    }
    runtime.gpu_info.cache_clear()


def test_gpu_info_returns_none_without_nvidia_smi(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime.gpu_info.cache_clear()
    monkeypatch.setattr(runtime.shutil, "which", lambda _name: None)

    assert runtime.gpu_info() is None
