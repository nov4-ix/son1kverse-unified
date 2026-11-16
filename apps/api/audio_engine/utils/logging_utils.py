"""
utils/logging_utils.py — Logging y performance tracking
Ported + enhanced from Son1k-Heart-main/utils/logging.py
"""

import logging
import sys
import time
from typing import Optional, Dict, Any
from contextlib import contextmanager


def setup_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """Configura un logger con formato consistente para el sistema."""
    logger = logging.getLogger(f"SON1KVERSE.{name}")
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(level)
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.propagate = False

    return logger


def log_gpu_memory(logger: logging.Logger):
    """Registra el uso actual de memoria GPU si está disponible."""
    try:
        import torch
        if torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated() / 1e6
            reserved  = torch.cuda.memory_reserved()  / 1e6
            logger.info(f"  GPU VRAM — Asignada: {allocated:.1f} MB | Reservada: {reserved:.1f} MB")
    except Exception:
        pass


class PerformanceTracker:
    """
    Context manager para medir tiempos de ejecución por etapa.
    Uso / Usage:
        with PerformanceTracker("Generación") as tracker:
            ...
            tracker.checkpoint("sección_1")
    """

    def __init__(self, name: str):
        self.name       = name
        self.start_time = 0.0
        self.checkpoints: Dict[str, float] = {}
        self._extra_metrics: Dict[str, Any] = {}
        self._logger    = setup_logger(f"Perf.{name}")

    def __enter__(self) -> "PerformanceTracker":
        self.start_time = time.perf_counter()
        self._logger.info(f"▶ Inicio: {self.name}")
        return self

    def __exit__(self, *_):
        elapsed = time.perf_counter() - self.start_time
        self._logger.info(f"■ Fin: {self.name} — {elapsed:.3f}s total")
        if self._extra_metrics:
            self._logger.info(f"  Métricas: {self._extra_metrics}")

    def checkpoint(self, label: str):
        """Registra un punto de control con el tiempo acumulado."""
        elapsed = time.perf_counter() - self.start_time
        self.checkpoints[label] = elapsed
        self._logger.info(f"  ✓ [{label}] @{elapsed:.3f}s")

    def add_metric(self, key: str, value: Any):
        """Agrega una métrica adicional al resumen final."""
        self._extra_metrics[key] = value

    def elapsed(self) -> float:
        return time.perf_counter() - self.start_time
