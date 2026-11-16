"""Tempo detection ported from HAM v1 using numpy autocorrelation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(slots=True)
class BPMDetectionResult:
    bpm: float
    confidence: float


def _to_mono(audio: np.ndarray) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 2:
        return np.mean(data, axis=0)
    return data


def onset_envelope(
    audio: np.ndarray, hop_length: int = 512, frame_length: int = 2048
) -> np.ndarray:
    mono = _to_mono(audio)
    if mono.size == 0:
        raise ValueError("Audio array cannot be empty")
    if mono.size < frame_length:
        mono = np.pad(mono, (0, frame_length - mono.size))
    frames = 1 + (mono.size - frame_length) // hop_length
    index = np.arange(frame_length)[np.newaxis, :] + hop_length * np.arange(frames)[:, np.newaxis]
    energy = np.sqrt(np.mean(np.square(mono[index]), axis=1) + 1e-12)
    flux = np.maximum(0.0, np.diff(energy, prepend=energy[:1]))
    mean = float(np.mean(flux))
    std = float(np.std(flux))
    if std <= 1e-9:
        return np.zeros_like(flux)
    return ((flux - mean) / std).astype(np.float32)


def detect_bpm_with_confidence(
    audio: np.ndarray,
    sample_rate: int,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
    hop_length: int = 512,
) -> BPMDetectionResult:
    envelope = onset_envelope(audio, hop_length=hop_length)
    if envelope.size < 8 or not np.any(envelope):
        return BPMDetectionResult(bpm=120.0, confidence=0.0)
    spectrum = np.fft.rfft(envelope, n=2 * envelope.size)
    autocorrelation = np.fft.irfft(spectrum * np.conj(spectrum))[: envelope.size]
    min_lag = max(1, int(round(60.0 * sample_rate / (max_bpm * hop_length))))
    max_lag = min(envelope.size - 1, int(round(60.0 * sample_rate / (min_bpm * hop_length))))
    if max_lag <= min_lag:
        return BPMDetectionResult(bpm=120.0, confidence=0.0)
    window = autocorrelation[min_lag : max_lag + 1]
    best = int(np.argmax(window)) + min_lag
    best_value = float(autocorrelation[best])
    mean_value = float(np.mean(np.abs(autocorrelation[1 : max_lag + 1]))) + 1e-9
    confidence = float(np.clip(best_value / (mean_value * 3.0), 0.0, 1.0))
    bpm = 60.0 * sample_rate / (best * hop_length)
    return BPMDetectionResult(bpm=round(float(bpm), 2), confidence=confidence)


def detect_bpm(
    audio: np.ndarray,
    sample_rate: int,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
    hop_length: int = 512,
) -> float:
    return detect_bpm_with_confidence(
        audio, sample_rate, min_bpm, max_bpm, hop_length
    ).bpm


def compute_time_stretch_ratio(
    base_bpm: float, target_bpm: float, max_stretch: float = 0.15
) -> float:
    if base_bpm <= 0 or target_bpm <= 0:
        raise ValueError("BPM values must be positive")
    return float(np.clip(target_bpm / base_bpm, 1.0 - max_stretch, 1.0 + max_stretch))
