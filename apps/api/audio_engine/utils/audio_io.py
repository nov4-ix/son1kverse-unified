"""
utils/audio_io.py — Lectura/escritura de audio y utilidades de arrays
Ported + enhanced from Son1k-Heart-main/utils/audio_io.py
"""

import uuid
import time
from pathlib import Path
from typing import Tuple, Optional
import numpy as np

# soundfile es la librería I/O primaria — librosa como fallback
import soundfile as sf

from utils.logging_utils import setup_logger
from config import AUDIO_CONFIG, COHERENT_CROSSFADE_SAMPLES

logger = setup_logger("AudioIO")


def load_audio(path: Path, target_sr: int = 44100) -> Tuple[np.ndarray, int]:
    """
    Carga un archivo de audio y lo remuestrea si es necesario.
    Retorna: (audio_array [channels, samples], sample_rate)
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Archivo de audio no encontrado: {path}")

    try:
        audio, sr = sf.read(str(path), always_2d=True)
        audio = audio.T.astype(np.float32)   # (channels, samples)
    except Exception as e:
        logger.warning(f"soundfile falló ({e}), intentando con librosa...")
        import librosa
        audio_mono, sr = librosa.load(str(path), sr=target_sr, mono=False)
        audio = audio_mono if audio_mono.ndim == 2 else np.stack([audio_mono, audio_mono])

    # Remuestreo si es necesario / Resample if needed
    if sr != target_sr:
        import librosa
        if audio.ndim == 2:
            resampled = np.stack([
                librosa.resample(ch, orig_sr=sr, target_sr=target_sr)
                for ch in audio
            ])
        else:
            resampled = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        audio = resampled
        sr    = target_sr

    logger.info(f"Audio cargado: {path.name} | SR={sr} | Shape={audio.shape}")
    return audio, sr


def save_audio(audio: np.ndarray, path: Path, sample_rate: int = 44100) -> Path:
    """
    Guarda audio numpy array a disco como WAV 24-bit.
    Acepta formato (channels, samples) o (samples,).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if audio.ndim == 2:
        audio_out = audio.T   # soundfile espera (samples, channels)
    else:
        audio_out = audio

    audio_out = np.clip(audio_out, -1.0, 1.0).astype(np.float32)
    sf.write(str(path), audio_out, sample_rate, subtype="PCM_24")
    logger.info(f"Audio guardado: {path} | {audio_out.shape}")
    return path


def concatenate_sections(
    sections: list[np.ndarray],
    crossfade_samples: int = COHERENT_CROSSFADE_SAMPLES,  # 300ms @ 44100 Hz
    spectral: bool = True,
) -> np.ndarray:
    """
    Concatena secciones de audio con crossfade espectral entre ellas.
    Todas las secciones deben ser (2, N) — stereo.
    """
    if not sections:
        raise ValueError("No hay secciones para concatenar")

    if len(sections) == 1:
        return sections[0]

    result = sections[0]
    for next_sec in sections[1:]:
        if spectral:
            result = _spectral_crossfade(result, next_sec, crossfade_samples)
        else:
            result = _linear_crossfade(result, next_sec, crossfade_samples)

    return result


def _linear_crossfade(a: np.ndarray, b: np.ndarray, fade_samples: int) -> np.ndarray:
    """Aplica crossfade lineal entre el fin de `a` y el inicio de `b`."""
    fade_samples = min(fade_samples, a.shape[-1] // 2, b.shape[-1] // 2)

    if a.ndim == 2:
        fade_out = np.linspace(1, 0, fade_samples)[np.newaxis, :]
        fade_in  = np.linspace(0, 1, fade_samples)[np.newaxis, :]
        overlap  = a[:, -fade_samples:] * fade_out + b[:, :fade_samples] * fade_in
        return np.concatenate([a[:, :-fade_samples], overlap, b[:, fade_samples:]], axis=1)
    else:
        fade_out = np.linspace(1, 0, fade_samples)
        fade_in  = np.linspace(0, 1, fade_samples)
        overlap  = a[-fade_samples:] * fade_out + b[:fade_samples] * fade_in
        return np.concatenate([a[:-fade_samples], overlap, b[fade_samples:]])


def _spectral_crossfade(a: np.ndarray, b: np.ndarray, fade_samples: int) -> np.ndarray:
    """
    Crossfade espectral: equilibra la energía RMS del final de `a` con el
    inicio de `b` antes del fundido, evitando saltos de energía y tono entre
    fragmentos. Todas las secciones deben ser (2, N) — stereo.
    """
    fade_samples = min(fade_samples, a.shape[-1] // 2, b.shape[-1] // 2)

    if fade_samples <= 0:
        return np.concatenate([a, b], axis=1)

    if a.ndim == 2:
        # RMS del final de 'a' y del inicio de 'b' para equilibrar energía
        rms_a = float(np.sqrt(np.mean(a[:, -fade_samples // 2:] ** 2) + 1e-12))
        rms_b = float(np.sqrt(np.mean(b[:, :fade_samples // 2] ** 2) + 1e-12))

        # Ganancia de equilibrio: elevar 'b' si su inicio es más débil que el final de 'a'
        gain_ratio = rms_a / (rms_b + 1e-8)
        gain_ratio = float(np.clip(gain_ratio, 0.5, 2.0))  # evitar saltos extremos

        b_adjusted = b.copy()
        b_adjusted[:, :fade_samples] *= gain_ratio

        fade_out = np.linspace(1, 0, fade_samples)[np.newaxis, :]
        fade_in  = np.linspace(0, 1, fade_samples)[np.newaxis, :]
        overlap  = a[:, -fade_samples:] * fade_out + b_adjusted[:, :fade_samples] * fade_in
        return np.concatenate([a[:, :-fade_samples], overlap, b_adjusted[:, fade_samples:]], axis=1)
    else:
        rms_a = float(np.sqrt(np.mean(a[-fade_samples // 2:] ** 2) + 1e-12))
        rms_b = float(np.sqrt(np.mean(b[:fade_samples // 2] ** 2) + 1e-12))
        gain_ratio = float(np.clip(rms_a / (rms_b + 1e-8), 0.5, 2.0))

        b_adjusted = b.copy()
        b_adjusted[:fade_samples] *= gain_ratio

        fade_out = np.linspace(1, 0, fade_samples)
        fade_in  = np.linspace(0, 1, fade_samples)
        overlap  = a[-fade_samples:] * fade_out + b_adjusted[:fade_samples] * fade_in
        return np.concatenate([a[:-fade_samples], overlap, b_adjusted[fade_samples:]])


def get_audio_duration(audio: np.ndarray, sample_rate: int) -> float:
    """Retorna duración en segundos."""
    n_samples = audio.shape[-1] if audio.ndim == 2 else len(audio)
    return n_samples / sample_rate


def ensure_stereo(audio: np.ndarray) -> np.ndarray:
    """Convierte mono a stereo si es necesario."""
    if audio.ndim == 1:
        return np.stack([audio, audio])
    if audio.ndim == 2 and audio.shape[0] == 1:
        return np.vstack([audio, audio])
    return audio


def generate_output_path(
    prefix: str,
    suffix: str,
    extension: str = "wav",
    output_type: str = "raw",
) -> Path:
    """Genera una ruta de salida única con timestamp y UUID corto."""
    from config import PATHS
    ts       = int(time.time())
    uid      = uuid.uuid4().hex[:6]
    filename = f"{prefix}_{suffix}_{ts}_{uid}.{extension}"
    return Path(PATHS[f"{output_type}_output"]) / filename


def concatenate_files(
    paths: list[str | Path],
    output_path: str | Path,
    crossfade_samples: int = COHERENT_CROSSFADE_SAMPLES,
    sample_rate: int = AUDIO_CONFIG["sample_rate"],
) -> Path:
    """
    Concatena varios archivos WAV en uno solo con crossfade entre bloques.
    Carga cada archivo, aplica concatenate_sections y guarda el resultado.
    """
    sample_rate = sample_rate or AUDIO_CONFIG["sample_rate"]

    if not paths:
        raise ValueError("No hay archivos para concatenar")

    audio_segments: list[np.ndarray] = []
    for p in paths:
        p = Path(p)
        if not p.exists():
            raise FileNotFoundError(f"Fragmento no encontrado: {p}")
        audio, sr = load_audio(p, target_sr=sample_rate)
        audio = ensure_stereo(audio)
        audio_segments.append(audio)

    final_audio = concatenate_sections(audio_segments, crossfade_samples=crossfade_samples)
    return save_audio(final_audio, Path(output_path), sample_rate=sample_rate)
