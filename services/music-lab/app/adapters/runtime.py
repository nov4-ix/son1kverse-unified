"""Lazy runtime probes that never import heavy ML libraries."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
from functools import lru_cache
from typing import Any


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


@lru_cache(maxsize=1)
def gpu_info() -> dict[str, Any] | None:
    """Return name and total VRAM of the first NVIDIA GPU without importing torch."""
    executable = shutil.which("nvidia-smi")
    if executable is None:
        return None
    try:
        completed = subprocess.run(
            [
                executable,
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    first_line = completed.stdout.strip().splitlines()
    if not first_line:
        return None
    parts = [part.strip() for part in first_line[0].split(",", 1)]
    if len(parts) != 2:
        return None
    name, raw_mb = parts
    try:
        total_mb = int(float(raw_mb))
    except ValueError:
        return None
    return {
        "name": name,
        "vram_total_mb": total_mb,
        "vram_total_gb": round(total_mb / 1024, 2),
    }
