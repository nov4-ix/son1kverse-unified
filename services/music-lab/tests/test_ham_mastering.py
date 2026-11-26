from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from app.audio import read_audio, write_audio
from app.ham import AlignmentConfig, HarmonicAligner, compute_time_stretch_ratio, detect_bpm
from app.ham.bpm import onset_envelope
from app.ham.energy import apply_fade, compute_peak_energy, compute_rms_energy, soft_clip
from app.mastering.chain import (
    MasteringChain,
    MasteringConfig,
    apply_fades,
    apply_tilt_eq,
    integrated_lufs,
    normalize_lufs,
    true_peak_limiter,
)
from app.schemas import OutputFormat


def _sine_wave(
    freq_hz: float,
    duration_s: float,
    sample_rate: int = 22050,
    amplitude: float = 0.25,
    channels: int = 2,
) -> np.ndarray:
    t = np.arange(int(sample_rate * duration_s), dtype=np.float32) / float(sample_rate)
    mono = (amplitude * np.sin(2.0 * np.pi * freq_hz * t)).astype(np.float32)
    if channels == 1:
        return mono
    return np.stack([mono, mono], axis=0)


def test_onset_envelope_rejects_empty_and_handles_silence() -> None:
    with pytest.raises(ValueError, match="empty"):
        onset_envelope(np.array([], dtype=np.float32))

    silent = np.zeros((2, 22050), dtype=np.float32)
    env = onset_envelope(silent)
    assert env.size > 0
    assert np.all(env == 0.0)
    assert detect_bpm(silent, 22050) == 120.0


def test_compute_time_stretch_ratio_clamps_and_validates() -> None:
    assert math.isclose(compute_time_stretch_ratio(120.0, 126.0), 1.05, rel_tol=1e-6)
    assert math.isclose(compute_time_stretch_ratio(100.0, 200.0, max_stretch=0.15), 1.15)
    assert math.isclose(compute_time_stretch_ratio(120.0, 60.0, max_stretch=0.15), 0.85)
    with pytest.raises(ValueError, match="positive"):
        compute_time_stretch_ratio(0.0, 120.0)


def test_harmonic_aligner_analyze_align_and_stitch() -> None:
    sr = 22050
    base = _sine_wave(440.0, 2.0, sample_rate=sr, amplitude=0.1)
    section = _sine_wave(659.25, 2.0, sample_rate=sr, amplitude=0.4)

    aligner = HarmonicAligner(sample_rate=sr, config=AlignmentConfig(crossfade_duration=0.25))
    analysis = aligner.analyze(base)
    assert analysis.key.key_name
    assert 0.0 <= analysis.key.confidence <= 1.0
    assert analysis.bpm > 0.0
    assert 0.0 <= analysis.bpm_confidence <= 1.0
    assert math.isfinite(analysis.rms) and analysis.rms > 0.0
    assert math.isfinite(analysis.spectral.centroid_hz)

    aligned = aligner.align_section(base, section)
    assert aligned.aligned_audio.shape == section.shape
    assert np.all(np.isfinite(aligned.aligned_audio))
    assert aligned.energy_aligned is True
    assert aligned.spectral_aligned is True

    stitched = aligner.stitch([base, aligned.aligned_audio], fade_duration=0.25)
    assert stitched.ndim == 2
    assert stitched.shape[1] < base.shape[1] + aligned.aligned_audio.shape[1]
    assert np.all(np.isfinite(stitched))


def test_energy_helpers_and_soft_clip() -> None:
    tone = _sine_wave(220.0, 1.0, sample_rate=22050, amplitude=1.2)
    assert compute_rms_energy(tone) > 0.5
    assert math.isclose(compute_peak_energy(tone), 1.2, rel_tol=1e-4)

    clipped = soft_clip(tone, threshold=0.8, amount=0.5)
    assert compute_peak_energy(clipped) < compute_peak_energy(tone)
    assert np.all(np.isfinite(clipped))

    faded = apply_fade(tone, fade_in_samples=200, fade_out_samples=200, curve="exponential")
    assert faded.shape == tone.shape
    assert np.all(np.isfinite(faded))


def test_mastering_chain_normalizes_lufs_and_limits_true_peak(tmp_path: Path) -> None:
    sr = 22050
    loud_clip = np.clip(_sine_wave(220.0, 2.0, sample_rate=sr, amplitude=1.8), -1.0, 1.0)
    cfg = MasteringConfig(target_lufs=-14.0, true_peak_db=-1.0)
    chain = MasteringChain(sample_rate=sr, config=cfg)

    mastered, metrics = chain.process(loud_clip)
    assert mastered.shape == loud_clip.shape
    assert np.all(np.isfinite(mastered))
    assert metrics.peak_after_db <= cfg.true_peak_db + 0.05
    assert abs(metrics.output_lufs - cfg.target_lufs) <= 1.0
    assert {"eq", "lufs", "limiter", "fade"}.issubset(set(metrics.stages))

    src = tmp_path / "track.wav"
    dst = tmp_path / "track-mastered.wav"
    write_audio(src, loud_clip, sr, OutputFormat.WAV)
    out_path, file_metrics = chain.master_file(src, dst, OutputFormat.WAV)
    assert out_path == dst
    assert dst.exists()
    loaded, loaded_sr = read_audio(dst)
    assert loaded_sr == sr
    assert loaded.shape == mastered.shape
    assert file_metrics.peak_after_db <= cfg.true_peak_db + 0.05


def test_mastering_primitives_handle_mono_and_silence() -> None:
    sr = 22050
    mono_tone = _sine_wave(330.0, 1.5, sample_rate=sr, amplitude=0.2, channels=1)
    eq_out = apply_tilt_eq(mono_tone, sr)
    assert eq_out.shape == (2, mono_tone.shape[-1])
    assert np.all(np.isfinite(eq_out))

    norm_out, inp_lufs, gain_db = normalize_lufs(mono_tone, sr, target_lufs=-14.0)
    assert math.isfinite(inp_lufs) and math.isfinite(gain_db)
    assert np.all(np.isfinite(norm_out))

    faded = apply_fades(mono_tone, sr, fade_in_s=0.05, fade_out_s=0.05)
    assert np.allclose(faded[:, 0], 0.0, atol=1e-6)
    assert np.allclose(faded[:, -1], 0.0, atol=1e-6)

    silent = np.zeros((2, sr), dtype=np.float32)
    assert integrated_lufs(silent, sr) == -70.0
    lim_out, _, peak_after_db = true_peak_limiter(silent, sr, threshold_db=-1.0)
    assert np.all(lim_out == 0.0)
    assert math.isfinite(peak_after_db)
