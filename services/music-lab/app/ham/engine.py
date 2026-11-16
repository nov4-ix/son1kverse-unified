"""Harmonic Alignment Module entry point (CPU-only, no librosa)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.ham.bpm import detect_bpm_with_confidence
from app.ham.energy import compute_rms_energy, match_energy
from app.ham.key import KeyDetectionResult, detect_key_with_confidence
from app.ham.spectral import (
    SpectralProfile,
    get_spectral_profile,
    match_spectral_profile,
)
from app.ham.stitcher import concatenate_with_crossfade


@dataclass(slots=True)
class AlignmentConfig:
    enable_key_alignment: bool = True
    enable_bpm_alignment: bool = True
    enable_energy_alignment: bool = True
    enable_spectral_alignment: bool = True
    target_energy: float = 0.15
    spectral_adjustment_intensity: float = 0.5
    crossfade_duration: float = 2.0


@dataclass(slots=True)
class SectionAnalysis:
    key: KeyDetectionResult
    bpm: float
    bpm_confidence: float
    rms: float
    spectral: SpectralProfile


@dataclass(slots=True)
class AlignmentResult:
    aligned_audio: np.ndarray
    base: SectionAnalysis
    section: SectionAnalysis
    key_shift_semitones: int
    energy_aligned: bool
    spectral_aligned: bool
    warnings: list[str] = field(default_factory=list)


class HarmonicAligner:
    """Aligns energy/spectral profile and reports key/BPM coherence.

    Pitch shifting and time stretching are intentionally not ported: the
    reference implementation relied on librosa. They are reported as warnings
    instead of silently changing the audio.
    """

    def __init__(self, sample_rate: int = 44100, config: AlignmentConfig | None = None) -> None:
        self.sample_rate = sample_rate
        self.config = config or AlignmentConfig()

    def analyze(self, audio: np.ndarray) -> SectionAnalysis:
        key = detect_key_with_confidence(audio, self.sample_rate)
        bpm = detect_bpm_with_confidence(audio, self.sample_rate)
        return SectionAnalysis(
            key=key,
            bpm=bpm.bpm,
            bpm_confidence=bpm.confidence,
            rms=compute_rms_energy(audio),
            spectral=get_spectral_profile(audio, self.sample_rate),
        )

    def align_section(self, base_audio: np.ndarray, section_audio: np.ndarray) -> AlignmentResult:
        base = self.analyze(base_audio)
        section = self.analyze(section_audio)
        aligned = np.asarray(section_audio, dtype=np.float32).copy()
        warnings: list[str] = []

        energy_aligned = False
        if self.config.enable_energy_alignment:
            aligned = match_energy(aligned, base_audio)
            energy_aligned = True

        spectral_aligned = False
        if self.config.enable_spectral_alignment:
            aligned = match_spectral_profile(
                aligned,
                base_audio,
                self.sample_rate,
                self.config.spectral_adjustment_intensity,
            )
            spectral_aligned = True

        if self.config.enable_key_alignment and base.key.key_index != section.key.key_index:
            warnings.append(
                "pitch alignment not applied (librosa-dependent in the source); "
                f"keys differ: {base.key.key_name} vs {section.key.key_name}"
            )
        if self.config.enable_bpm_alignment and abs(base.bpm - section.bpm) > 0.5:
            warnings.append(
                "time stretch not applied (librosa-dependent in the source); "
                f"BPM differs: {base.bpm:.1f} vs {section.bpm:.1f}"
            )

        return AlignmentResult(
            aligned_audio=aligned,
            base=base,
            section=section,
            key_shift_semitones=(section.key.key_index - base.key.key_index) % 12,
            energy_aligned=energy_aligned,
            spectral_aligned=spectral_aligned,
            warnings=warnings,
        )

    def stitch(self, sections: list[np.ndarray], fade_duration: float | None = None) -> np.ndarray:
        return concatenate_with_crossfade(
            sections,
            self.sample_rate,
            fade_duration if fade_duration is not None else self.config.crossfade_duration,
        )


def create_aligner(
    sample_rate: int = 44100, config: AlignmentConfig | None = None
) -> HarmonicAligner:
    return HarmonicAligner(sample_rate=sample_rate, config=config)
