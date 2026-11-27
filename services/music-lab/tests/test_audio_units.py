"""Unit tests for the CPU HAM and mastering ports."""

from __future__ import annotations

import numpy as np
import pytest

from app.adapters.simulation import render_simulation
from app.audio import validate_generated_audio
from app.errors import InvalidAudioError
from app.ham import (
    HarmonicAligner,
    concatenate_with_crossfade,
    detect_bpm,
    detect_key_with_confidence,
    pad_to_length,
    trim_silence,
)
from app.mastering import MasteringChain, integrated_lufs
from app.schemas import GenerateRequest


def _request(duration_s: float = 2.0, seed: int = 1) -> GenerateRequest:
    return GenerateRequest(prompt="unit", duration_s=duration_s, seed=seed, bpm=120, key="Am")


def test_simulation_is_deterministic_and_stems_add_up() -> None:
    first = render_simulation(_request(), 44100)
    second = render_simulation(_request(), 44100)
    assert np.array_equal(first.mix, second.mix)
    assert np.allclose(first.drums + first.bass + first.other, first.mix, atol=1e-6)


def test_bpm_and_key_detection_run_on_cpu() -> None:
    rendered = render_simulation(_request(3.0), 44100)
    bpm = detect_bpm(rendered.mix, 44100)
    key = detect_key_with_confidence(rendered.mix, 44100)
    assert abs(bpm - 120.0) < 3.0
    assert 0.0 <= key.confidence <= 1.0
    assert key.key_name


def test_generated_audio_validation_rejects_nan_and_silence() -> None:
    valid = render_simulation(_request(0.5), 44100).mix
    validate_generated_audio(valid, engine="ace-step", operation="generate")

    with_nan = valid.copy()
    with_nan[0, 10] = np.nan
    with pytest.raises(InvalidAudioError) as nan_error:
        validate_generated_audio(with_nan, engine="ace-step", operation="generate")
    assert "NaN" in nan_error.value.message

    with pytest.raises(InvalidAudioError) as silence_error:
        validate_generated_audio(
            np.zeros((2, 100), dtype=np.float32), engine="ace-step", operation="generate"
        )
    assert "silent" in silence_error.value.message.lower()


def test_harmonic_aligner_reports_unported_operations() -> None:
    rendered = render_simulation(_request(2.0), 44100)
    slower = render_simulation(
        GenerateRequest(prompt="unit", duration_s=2.0, seed=2, bpm=90, key="C"), 44100
    )
    result = HarmonicAligner(44100).align_section(rendered.mix, slower.mix)
    assert result.energy_aligned is True
    assert result.spectral_aligned is True
    assert any("time stretch not applied" in warning for warning in result.warnings)
    assert result.key_shift_semitones == 0


def test_stitcher_and_mastering_bounds() -> None:
    rendered = render_simulation(_request(2.0), 44100)
    left = rendered.mix[:, : 22050]
    right = rendered.mix[:, 22050:44100]
    stitched = concatenate_with_crossfade([left, right], 44100, fade_duration=0.05)
    assert stitched.shape[1] == 22050 + 22050 - 2205

    padded = pad_to_length(left, 30000)
    assert padded.shape[1] == 30000
    assert trim_silence(np.zeros((2, 100), dtype=np.float32)).shape[1] == 0

    mastered, metrics = MasteringChain(44100).process(rendered.mix)
    assert abs(integrated_lufs(mastered, 44100) - (-14.0)) < 0.5
    assert np.max(np.abs(mastered)) <= 10 ** (-1.0 / 20.0) + 0.01
    assert metrics.stages[0] == "eq"
