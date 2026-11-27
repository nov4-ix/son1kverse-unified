"""File and audio helpers shared by the adapters."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from app.errors import InvalidAudioError, InvalidRequestError, OutputFormatError
from app.schemas import OutputFormat

AudioArray = np.ndarray
SILENCE_PEAK_THRESHOLD = 1e-6


def validate_generated_audio(
    audio: AudioArray, *, engine: str, operation: str
) -> None:
    """Reject non-finite samples and fully silent renders before writing files."""
    data = np.asarray(audio, dtype=np.float32)
    context = {"engine": engine, "operation": operation}
    if data.size == 0 or (data.ndim >= 2 and data.shape[-1] == 0):
        raise InvalidAudioError("Generated audio is empty", details=context)
    if not np.isfinite(data).all():
        raise InvalidAudioError(
            "Generated audio contains NaN or Inf samples",
            details={**context, "reason": "non_finite"},
        )
    peak = float(np.max(np.abs(data)))
    if peak <= SILENCE_PEAK_THRESHOLD:
        raise InvalidAudioError(
            "Generated audio is silent",
            details={**context, "reason": "silence", "peak": peak},
        )


def ensure_stereo(audio: AudioArray) -> AudioArray:
    """Return a float32 array shaped (2, samples)."""
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        return np.stack([data, data])
    if data.ndim == 2 and data.shape[0] == 1:
        return np.vstack([data, data])
    if data.ndim == 2 and data.shape[0] == 2:
        return data
    if data.ndim == 2:
        mono = np.mean(data, axis=1)
        return np.stack([mono, mono])
    raise InvalidRequestError("Unsupported audio shape", details={"shape": list(data.shape)})


def read_audio(path: Path) -> tuple[AudioArray, int]:
    if not path.is_file():
        raise InvalidRequestError("Audio file not found", details={"path": str(path)})
    try:
        data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise InvalidRequestError(
            "Audio file could not be decoded",
            details={"path": str(path), "reason": str(exc)},
        ) from exc
    return ensure_stereo(data.T), int(sample_rate)


def write_audio(
    path: Path,
    audio: AudioArray,
    sample_rate: int,
    output_format: OutputFormat = OutputFormat.WAV,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.clip(ensure_stereo(audio), -1.0, 1.0).T
    if output_format is OutputFormat.WAV:
        sf.write(str(path), data, sample_rate, subtype="PCM_16", format="WAV")
    elif output_format is OutputFormat.MP3:
        try:
            sf.write(str(path), data, sample_rate, format="MP3")
        except Exception as exc:
            raise OutputFormatError(
                "MP3 encoding is not available on this host",
                details={"reason": str(exc)},
            ) from exc
    else:
        raise OutputFormatError(details={"format": output_format.value})
    return path


def resolve_output_file(raw_path: str, output_dir: Path) -> Path:
    """Resolve a source file and require it to live inside the output dir."""
    base = output_dir.resolve()
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = base / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(base)
    except ValueError as exc:
        raise InvalidRequestError(
            "Source audio must live inside MUSIC_LAB_OUTPUT_DIR",
            details={"path": str(resolved), "output_dir": str(base)},
        ) from exc
    if not resolved.is_file():
        raise InvalidRequestError("Source audio not found", details={"path": str(resolved)})
    return resolved


def resample_if_needed(audio: AudioArray, source_sr: int, target_sr: int) -> AudioArray:
    if source_sr == target_sr:
        return audio
    from math import gcd

    from scipy.signal import resample_poly

    factor = gcd(source_sr, target_sr)
    up = target_sr // factor
    down = source_sr // factor
    channels = [resample_poly(channel, up, down) for channel in audio]
    return np.stack(channels).astype(np.float32)
