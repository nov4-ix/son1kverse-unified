"""Energy analysis and normalization ported from HAM v1."""

from __future__ import annotations

import numpy as np


def compute_rms_energy(audio: np.ndarray) -> float:
    data = np.asarray(audio, dtype=np.float32)
    if data.size == 0:
        raise ValueError("Audio array cannot be empty")
    return float(np.sqrt(np.mean(np.square(data)) + 1e-12))


def compute_rms_envelope(
    audio: np.ndarray, frame_length: int = 2048, hop_length: int = 512
) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 2:
        mono = np.mean(data, axis=0)
    else:
        mono = data
    if mono.size == 0:
        raise ValueError("Audio array cannot be empty")
    if mono.size < frame_length:
        mono = np.pad(mono, (0, frame_length - mono.size))
    frames = 1 + (mono.size - frame_length) // hop_length
    index = np.arange(frame_length)[np.newaxis, :] + hop_length * np.arange(frames)[:, np.newaxis]
    return np.sqrt(np.mean(np.square(mono[index]), axis=1) + 1e-12).astype(np.float32)


def normalize_energy(
    audio: np.ndarray, target_energy: float, peak_limit: float = 0.99
) -> np.ndarray:
    if not 0.0 < target_energy <= 1.0:
        raise ValueError("target_energy must be between 0 and 1")
    if not 0.0 < peak_limit <= 1.0:
        raise ValueError("peak_limit must be between 0 and 1")
    data = np.asarray(audio, dtype=np.float32)
    current = compute_rms_energy(data)
    if current <= 1e-9:
        return data.copy()
    gain = target_energy / current
    peak = float(np.max(np.abs(data)))
    if peak * gain > peak_limit:
        gain = peak_limit / max(peak, 1e-9)
    return (data * gain).astype(np.float32)


def match_energy(
    audio: np.ndarray, reference: np.ndarray, target_energy: float | None = None
) -> np.ndarray:
    energy = compute_rms_energy(reference) if target_energy is None else target_energy
    return normalize_energy(audio, max(min(energy, 0.99), 1e-4))


def apply_fade(
    audio: np.ndarray,
    fade_in_samples: int = 0,
    fade_out_samples: int = 0,
    curve: str = "linear",
) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32).copy()
    total = data.shape[-1]
    if fade_in_samples > 0:
        count = min(fade_in_samples, total)
        data[..., :count] *= _fade_curve(count, curve, fade_in=True)
    if fade_out_samples > 0:
        count = min(fade_out_samples, total)
        data[..., total - count :] *= _fade_curve(count, curve, fade_in=False)
    return data.astype(np.float32)


def compute_peak_energy(audio: np.ndarray) -> float:
    data = np.asarray(audio, dtype=np.float32)
    if data.size == 0:
        raise ValueError("Audio array cannot be empty")
    return float(np.max(np.abs(data)))


def soft_clip(audio: np.ndarray, threshold: float = 0.8, amount: float = 0.5) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32).copy()
    over = np.abs(data) > threshold
    if not np.any(over):
        return data
    excess = np.abs(data[over]) - threshold
    data[over] = np.sign(data[over]) * (threshold + np.tanh(excess * amount) / amount)
    return data.astype(np.float32)


def _fade_curve(samples: int, curve: str, *, fade_in: bool) -> np.ndarray:
    if curve == "exponential":
        values = np.exp(np.linspace(-6.0, 0.0, samples)) if fade_in else np.exp(
            np.linspace(0.0, -6.0, samples)
        )
    elif curve == "logarithmic":
        values = np.logspace(-2.0, 0.0, samples) if fade_in else np.logspace(0.0, -2.0, samples)
    else:
        values = np.linspace(0.0, 1.0, samples) if fade_in else np.linspace(1.0, 0.0, samples)
    return values.astype(np.float32)
