"""Lightweight spectral analysis/matching ported from HAM v1."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(slots=True)
class SpectralProfile:
    centroid_hz: float
    bandwidth_hz: float
    rolloff_hz: float
    flatness: float


def _mono(audio: np.ndarray) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    return np.mean(data, axis=0) if data.ndim == 2 else data


def _magnitude(audio: np.ndarray, n_fft: int = 4096) -> tuple[np.ndarray, np.ndarray]:
    mono = _mono(audio)
    size = max(n_fft, int(2 ** np.ceil(np.log2(max(mono.size, 2)))))
    spectrum = np.abs(np.fft.rfft(mono, n=size))
    frequencies = np.fft.rfftfreq(size, 1.0 / 44100.0)
    return spectrum, frequencies


def compute_spectral_centroid(audio: np.ndarray, sample_rate: int) -> float:
    spectrum, frequencies = _magnitude(audio)
    if sample_rate != 44100:
        frequencies = frequencies * (sample_rate / 44100.0)
    total = float(np.sum(spectrum))
    if total <= 1e-12:
        return 0.0
    return float(np.sum(frequencies * spectrum) / total)


def get_spectral_profile(audio: np.ndarray, sample_rate: int) -> SpectralProfile:
    spectrum, frequencies = _magnitude(audio)
    if sample_rate != 44100:
        frequencies = frequencies * (sample_rate / 44100.0)
    total = float(np.sum(spectrum))
    if total <= 1e-12:
        return SpectralProfile(0.0, 0.0, 0.0, 0.0)
    centroid = float(np.sum(frequencies * spectrum) / total)
    bandwidth = float(np.sqrt(np.sum(((frequencies - centroid) ** 2) * spectrum) / total))
    cumulative = np.cumsum(spectrum)
    rolloff_index = int(np.searchsorted(cumulative, 0.85 * cumulative[-1]))
    rolloff = float(frequencies[min(rolloff_index, frequencies.size - 1)])
    flatness = float(
        np.exp(np.mean(np.log(np.maximum(spectrum, 1e-12))))
        / (np.mean(np.maximum(spectrum, 1e-12)) + 1e-12)
    )
    return SpectralProfile(centroid, bandwidth, rolloff, flatness)


def apply_spectral_adjustment(
    audio: np.ndarray, sample_rate: int, reference_centroid: float, intensity: float = 0.5
) -> np.ndarray:
    if intensity <= 0.0:
        return np.asarray(audio, dtype=np.float32).copy()
    data = np.asarray(audio, dtype=np.float32).copy()
    current = compute_spectral_centroid(data, sample_rate)
    if current <= 1e-9 or reference_centroid <= 1e-9:
        return data
    ratio = reference_centroid / current
    if abs(ratio - 1.0) < 0.05:
        return data
    gain_db = float(np.clip(3.0 * intensity * abs(ratio - 1.0), 0.0, 4.0))
    gain = 10.0 ** (gain_db / 20.0)
    shelf = "high" if ratio > 1.0 else "low"
    for channel in range(data.shape[0]):
        data[channel] = _apply_shelf(data[channel], sample_rate, 2000.0, gain, shelf)
    peak = float(np.max(np.abs(data)))
    if peak > 0.99:
        data *= 0.95 / peak
    return data.astype(np.float32)


def match_spectral_profile(
    source: np.ndarray, target: np.ndarray, sample_rate: int, intensity: float = 0.7
) -> np.ndarray:
    reference = compute_spectral_centroid(target, sample_rate)
    return apply_spectral_adjustment(source, sample_rate, reference, intensity)


def _apply_shelf(
    audio: np.ndarray, sample_rate: int, crossover_hz: float, gain: float, shelf: str
) -> np.ndarray:
    size = int(2 ** np.ceil(np.log2(max(audio.size, 2))))
    spectrum = np.fft.rfft(audio, n=size)
    frequencies = np.fft.rfftfreq(size, 1.0 / sample_rate)
    width = max(crossover_hz * 0.5, 1.0)
    if shelf == "high":
        blend = np.clip((frequencies - (crossover_hz - width)) / width, 0.0, 1.0)
    else:
        blend = np.clip(((crossover_hz + width) - frequencies) / width, 0.0, 1.0)
    curve = 1.0 + (gain - 1.0) * 0.5 * blend
    return np.fft.irfft(spectrum * curve, n=size)[: audio.size].astype(np.float32)
