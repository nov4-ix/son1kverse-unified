"""Crossfade and stitching helpers ported from HAM v1 (numpy only)."""

from __future__ import annotations

import numpy as np


def crossfade(
    first: np.ndarray,
    second: np.ndarray,
    fade_duration: float,
    sample_rate: int,
    curve: str = "logarithmic",
    mode: str = "equal_power",
) -> np.ndarray:
    a = np.asarray(first, dtype=np.float32).copy()
    b = np.asarray(second, dtype=np.float32).copy()
    a_len = a.shape[-1]
    b_len = b.shape[-1]
    fade_samples = int(fade_duration * sample_rate)
    fade_samples = max(1, min(fade_samples, a_len // 2, b_len // 2))

    fade_out = _fade_curve(fade_samples, curve, direction="out")
    fade_in = _fade_curve(fade_samples, curve, direction="in")
    if mode == "equal_power":
        fade_out = np.sqrt(fade_out)
        fade_in = np.sqrt(fade_in)

    a[..., -fade_samples:] *= fade_out
    b[..., :fade_samples] *= fade_in
    overlap = a[..., -fade_samples:] + b[..., :fade_samples]
    combined = np.concatenate([a[..., :-fade_samples], overlap, b[..., fade_samples:]], axis=-1)

    peak = float(np.max(np.abs(combined))) if combined.size else 0.0
    if peak > 0.99:
        combined *= 0.95 / peak
    return combined.astype(np.float32)


def concatenate_with_crossfade(
    sections: list[np.ndarray],
    sample_rate: int,
    fade_duration: float = 2.0,
    apply_fade_edges: bool = True,
) -> np.ndarray:
    if not sections:
        raise ValueError("Sections list cannot be empty")
    result = np.asarray(sections[0], dtype=np.float32).copy()
    for section in sections[1:]:
        result = crossfade(result, section, fade_duration, sample_rate)
    if apply_fade_edges:
        result = _apply_edge_fades(result, sample_rate)
    return result


def trim_silence(audio: np.ndarray, threshold: float = 1e-4) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.size == 0:
        return data.copy()
    envelope = np.max(np.abs(data), axis=0) if data.ndim == 2 else np.abs(data)
    non_silent = np.flatnonzero(envelope > threshold)
    if non_silent.size == 0:
        return data[..., :0].copy()
    return data[..., non_silent[0] : non_silent[-1] + 1].copy()


def pad_to_length(audio: np.ndarray, target_length: int, mode: str = "zero") -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.shape[-1] >= target_length:
        return data[..., :target_length].copy()
    padding = target_length - data.shape[-1]
    if mode == "edge":
        pad_values = np.repeat(data[..., -1:], padding, axis=-1)
    else:
        pad_values = np.zeros((*data.shape[:-1], padding), dtype=np.float32)
    return np.concatenate([data, pad_values], axis=-1)


def _fade_curve(samples: int, curve: str, direction: str) -> np.ndarray:
    if curve == "linear":
        values = np.linspace(0.0, 1.0, samples) if direction == "in" else np.linspace(
            1.0, 0.0, samples
        )
    elif curve == "exponential":
        values = np.exp(np.linspace(-6.0, 0.0, samples)) if direction == "in" else np.exp(
            np.linspace(0.0, -6.0, samples)
        )
    else:
        values = np.logspace(-3.0, 0.0, samples) if direction == "in" else np.logspace(
            0.0, -3.0, samples
        )
    return values.astype(np.float32)


def _apply_edge_fades(
    audio: np.ndarray, sample_rate: int, fade_duration: float = 0.05
) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32).copy()
    count = min(max(1, int(fade_duration * sample_rate)), data.shape[-1] // 2)
    data[..., :count] *= np.linspace(0.0, 1.0, count, dtype=np.float32)
    data[..., -count:] *= np.linspace(1.0, 0.0, count, dtype=np.float32)
    return data
