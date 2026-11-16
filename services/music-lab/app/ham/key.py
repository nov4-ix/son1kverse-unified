"""Musical key detection ported from HAM v1/v2 without librosa."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_PROFILE = np.array([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], dtype=np.float32)
MINOR_PROFILE = np.array([1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], dtype=np.float32)


@dataclass(slots=True)
class KeyDetectionResult:
    key_index: int
    key_name: str
    mode: str
    confidence: float


def _to_mono(audio: np.ndarray) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 2:
        return np.mean(data, axis=0)
    return data


def _chroma(audio: np.ndarray, sample_rate: int, n_fft: int, hop_length: int) -> np.ndarray:
    mono = _to_mono(audio)
    if mono.size == 0:
        raise ValueError("Audio array cannot be empty")
    if mono.size < n_fft:
        mono = np.pad(mono, (0, n_fft - mono.size))
    window = np.hanning(n_fft).astype(np.float32)
    frequencies = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    valid = frequencies >= 32.0
    midi = 69.0 + 12.0 * np.log2(np.maximum(frequencies, 1e-9) / 440.0)
    pitch_class = np.mod(np.round(midi).astype(int), 12)
    chroma = np.zeros(12, dtype=np.float64)
    for start in range(0, mono.size - n_fft + 1, hop_length):
        frame = mono[start : start + n_fft] * window
        magnitude = np.abs(np.fft.rfft(frame))
        chroma += np.bincount(
            pitch_class[valid], weights=magnitude[valid], minlength=12
        )
    total = float(np.sum(chroma))
    if total <= 1e-12:
        return np.full(12, 1.0 / 12.0, dtype=np.float32)
    return (chroma / total).astype(np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denominator <= 1e-12:
        return 0.0
    return float(np.dot(a, b) / denominator)


def detect_key_with_confidence(
    audio: np.ndarray,
    sample_rate: int,
    n_fft: int = 4096,
    hop_length: int = 1024,
) -> KeyDetectionResult:
    chroma = _chroma(audio, sample_rate, n_fft, hop_length)
    scores: list[tuple[float, int, str]] = []
    for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
        for shift in range(12):
            scores.append((_cosine(chroma, np.roll(profile, shift)), shift, mode))
    scores.sort(reverse=True)
    best_score, best_key, best_mode = scores[0]
    second_score = scores[1][0]
    confidence = float(np.clip((best_score - second_score) * 2.0, 0.0, 1.0))
    return KeyDetectionResult(
        key_index=int(best_key),
        key_name=KEY_NAMES[int(best_key)],
        mode=best_mode,
        confidence=confidence,
    )


def detect_key(
    audio: np.ndarray,
    sample_rate: int,
    n_fft: int = 4096,
    hop_length: int = 1024,
) -> int:
    return detect_key_with_confidence(audio, sample_rate, n_fft, hop_length).key_index


def get_key_name(key_index: int) -> str:
    return KEY_NAMES[int(key_index) % 12]


def compute_semitone_shift(base_key: int, target_key: int) -> int:
    """Shortest signed semitone shift from base to target (-6..+5)."""
    return int((int(target_key) - int(base_key) + 6) % 12 - 6)
