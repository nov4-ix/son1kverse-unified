"""Lazy runtime probes that never import heavy ML libraries."""

from __future__ import annotations

import importlib.util
import shutil


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def cuda_available() -> bool:
    """Best-effort probe used before importing torch."""
    return shutil.which("nvidia-smi") is not None


def wants_cuda(device: str) -> bool:
    return device.strip().lower().startswith("cuda")
