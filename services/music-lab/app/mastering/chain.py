"""CPU-only mastering chain ported from son1k-heart.

Ported: LUFS-style normalization, gentle EQ, true-peak limiter and fades.
Discarded from the source: pyloudnorm dependency, multiband compressor and
stereo enhancer (not required by the Music Lab contract).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.ndimage import minimum_filter1d
from scipy.signal import butter, lfilter, sosfilt

from app.audio import read_audio, write_audio
from app.schemas import OutputFormat


@dataclass(slots=True)
class MasteringConfig:
    target_lufs: float = -14.0
    true_peak_db: float = -1.0
    fade_in_s: float = 0.01
    fade_out_s: float = 0.08
    eq_high_shelf_db: float = 1.0
    eq_low_shelf_db: float = -0.5
    limiter_lookahead_ms: float = 5.0
    limiter_release_ms: float = 50.0


@dataclass(slots=True)
class MasteringMetrics:
    input_lufs: float
    output_lufs: float
    gain_db: float
    peak_before_db: float
    peak_after_db: float
    stages: list[str] = field(default_factory=list)


def _as_stereo(audio: np.ndarray) -> np.ndarray:
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        return np.stack([data, data])
    return data


def _k_weight(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    nyquist = sample_rate / 2.0
    sos = butter(2, min(38.0, nyquist * 0.9) / nyquist, btype="highpass", output="sos")
    filtered = sosfilt(sos, audio, axis=-1)
    size = int(2 ** np.ceil(np.log2(max(audio.shape[-1], 2))))
    spectrum = np.fft.rfft(filtered, n=size, axis=-1)
    frequencies = np.fft.rfftfreq(size, 1.0 / sample_rate)
    shelf = 1.0 + (10.0 ** (4.0 / 20.0) - 1.0) * np.clip(
        (frequencies - 1000.0) / 2000.0, 0.0, 1.0
    )
    return np.fft.irfft(spectrum * shelf, n=size, axis=-1)[..., : audio.shape[-1]]


def integrated_lufs(audio: np.ndarray, sample_rate: int) -> float:
    """Approximate BS.1770 integrated loudness with absolute/relative gating."""
    data = _as_stereo(audio)
    weighted = _k_weight(data, sample_rate)
    block = max(1, int(0.4 * sample_rate))
    step = max(1, int(0.1 * sample_rate))
    power = np.sum(np.square(weighted), axis=0)
    if power.size < block:
        blocks = np.array([float(np.mean(power))])
    else:
        cumulative = np.concatenate([[0.0], np.cumsum(power, dtype=np.float64)])
        starts = np.arange(0, power.size - block + 1, step)
        blocks = (cumulative[starts + block] - cumulative[starts]) / block
    if blocks.size == 0:
        return -70.0
    loudness = -0.691 + 10.0 * np.log10(np.maximum(blocks, 1e-12))
    gated = loudness[loudness > -70.0]
    if gated.size == 0:
        return -70.0
    relative_threshold = float(np.mean(gated)) - 10.0
    final = loudness[loudness > max(-70.0, relative_threshold)]
    if final.size == 0:
        return -70.0
    return float(np.mean(final))


def normalize_lufs(
    audio: np.ndarray, sample_rate: int, target_lufs: float = -14.0
) -> tuple[np.ndarray, float, float]:
    data = _as_stereo(audio)
    current = integrated_lufs(data, sample_rate)
    if not np.isfinite(current):
        current = -23.0
    gain_db = float(target_lufs - current)
    normalized = (data * (10.0 ** (gain_db / 20.0))).astype(np.float32)
    return normalized, current, gain_db


def apply_tilt_eq(
    audio: np.ndarray,
    sample_rate: int,
    high_shelf_db: float = 1.0,
    low_shelf_db: float = -0.5,
) -> np.ndarray:
    data = _as_stereo(audio)
    size = int(2 ** np.ceil(np.log2(max(data.shape[-1], 2))))
    spectrum = np.fft.rfft(data, n=size, axis=-1)
    frequencies = np.fft.rfftfreq(size, 1.0 / sample_rate)
    high = 1.0 + (10.0 ** (high_shelf_db / 20.0) - 1.0) * np.clip(
        (frequencies - 4000.0) / 8000.0, 0.0, 1.0
    )
    low = 1.0 + (10.0 ** (low_shelf_db / 20.0) - 1.0) * np.clip(
        (250.0 - frequencies) / 250.0, 0.0, 1.0
    )
    return np.fft.irfft(spectrum * high * low, n=size, axis=-1)[..., : data.shape[-1]].astype(
        np.float32
    )


def true_peak_limiter(
    audio: np.ndarray,
    sample_rate: int,
    threshold_db: float = -1.0,
    lookahead_ms: float = 5.0,
    release_ms: float = 50.0,
) -> tuple[np.ndarray, float, float]:
    data = _as_stereo(audio)
    threshold = 10.0 ** (threshold_db / 20.0)
    envelope = np.max(np.abs(data), axis=0)
    desired = np.minimum(1.0, threshold / (envelope + 1e-9))
    lookahead = max(1, int(lookahead_ms * sample_rate / 1000.0))
    pad = lookahead // 2
    padded = np.pad(desired, (pad, pad), mode="edge")
    gain = minimum_filter1d(padded, size=lookahead, mode="nearest")[pad : pad + desired.size]
    release = max(1.0, release_ms * sample_rate / 1000.0)
    alpha = float(np.exp(-1.0 / release))
    gain = lfilter([1.0 - alpha], [1.0, -alpha], gain, zi=np.array([alpha]))[0]
    gain = np.minimum(gain, desired)
    gain = np.clip(gain, 0.0, 1.0).astype(np.float32)
    limited = (data * gain).astype(np.float32)
    peak_before = float(np.max(np.abs(data))) if data.size else 0.0
    peak_after = float(np.max(np.abs(limited))) if limited.size else 0.0
    if peak_after > threshold:
        limited *= threshold / max(peak_after, 1e-9)
        peak_after = threshold
    return limited, _db(peak_before), _db(peak_after)


def apply_fades(
    audio: np.ndarray, sample_rate: int, fade_in_s: float = 0.01, fade_out_s: float = 0.08
) -> np.ndarray:
    data = _as_stereo(audio).copy()
    samples = data.shape[-1]
    fade_in = min(samples, max(1, int(fade_in_s * sample_rate)))
    fade_out = min(samples, max(1, int(fade_out_s * sample_rate)))
    data[..., :fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    data[..., -fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    return data


class MasteringChain:
    def __init__(
        self,
        sample_rate: int = 44100,
        config: MasteringConfig | None = None,
    ) -> None:
        self.sample_rate = sample_rate
        self.config = config or MasteringConfig()

    def process(self, audio: np.ndarray) -> tuple[np.ndarray, MasteringMetrics]:
        data = _as_stereo(audio).astype(np.float32)
        stages: list[str] = []

        peak_before = _db(float(np.max(np.abs(data))) if data.size else 0.0)
        data = apply_tilt_eq(data, self.sample_rate, self.config.eq_high_shelf_db,
                             self.config.eq_low_shelf_db)
        stages.append("eq")

        data, input_lufs, gain_db = normalize_lufs(
            data, self.sample_rate, self.config.target_lufs
        )
        stages.append("lufs")

        data, _, peak_after = true_peak_limiter(
            data,
            self.sample_rate,
            self.config.true_peak_db,
            self.config.limiter_lookahead_ms,
            self.config.limiter_release_ms,
        )
        stages.append("limiter")

        data = apply_fades(data, self.sample_rate, self.config.fade_in_s, self.config.fade_out_s)
        stages.append("fade")

        output_lufs = integrated_lufs(data, self.sample_rate)
        if abs(output_lufs - self.config.target_lufs) > 0.5:
            makeup_db = self.config.target_lufs - output_lufs
            data = (data * (10.0 ** (makeup_db / 20.0))).astype(np.float32)
            data, _, peak_after = true_peak_limiter(
                data,
                self.sample_rate,
                self.config.true_peak_db,
                self.config.limiter_lookahead_ms,
                self.config.limiter_release_ms,
            )
            output_lufs = integrated_lufs(data, self.sample_rate)
            stages.append("lufs_makeup")
        metrics = MasteringMetrics(
            input_lufs=round(input_lufs, 2),
            output_lufs=round(output_lufs, 2),
            gain_db=round(gain_db, 2),
            peak_before_db=round(peak_before, 2),
            peak_after_db=round(peak_after, 2),
            stages=stages,
        )
        return data, metrics

    def master_file(
        self,
        input_path: Path,
        output_path: Path,
        output_format: OutputFormat = OutputFormat.WAV,
    ) -> tuple[Path, MasteringMetrics]:
        audio, sample_rate = read_audio(input_path)
        if sample_rate != self.sample_rate:
            self.sample_rate = sample_rate
        mastered, metrics = self.process(audio)
        write_audio(output_path, mastered, self.sample_rate, output_format)
        return output_path, metrics


def _db(value: float) -> float:
    return 20.0 * float(np.log10(max(value, 1e-9)))
