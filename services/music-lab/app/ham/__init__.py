"""Harmonic Alignment Module (CPU-only port)."""

from app.ham.bpm import BPMDetectionResult, compute_time_stretch_ratio, detect_bpm
from app.ham.energy import (
    apply_fade,
    compute_peak_energy,
    compute_rms_energy,
    compute_rms_envelope,
    match_energy,
    normalize_energy,
    soft_clip,
)
from app.ham.engine import (
    AlignmentConfig,
    AlignmentResult,
    HarmonicAligner,
    SectionAnalysis,
    create_aligner,
)
from app.ham.key import (
    KEY_NAMES,
    KeyDetectionResult,
    compute_semitone_shift,
    detect_key,
    detect_key_with_confidence,
    get_key_name,
)
from app.ham.spectral import (
    SpectralProfile,
    apply_spectral_adjustment,
    compute_spectral_centroid,
    get_spectral_profile,
    match_spectral_profile,
)
from app.ham.stitcher import (
    concatenate_with_crossfade,
    crossfade,
    pad_to_length,
    trim_silence,
)

__all__ = [
    "KEY_NAMES",
    "AlignmentConfig",
    "AlignmentResult",
    "BPMDetectionResult",
    "HarmonicAligner",
    "KeyDetectionResult",
    "SectionAnalysis",
    "SpectralProfile",
    "apply_fade",
    "apply_spectral_adjustment",
    "compute_peak_energy",
    "compute_rms_energy",
    "compute_rms_envelope",
    "compute_semitone_shift",
    "compute_spectral_centroid",
    "compute_time_stretch_ratio",
    "concatenate_with_crossfade",
    "create_aligner",
    "crossfade",
    "detect_bpm",
    "detect_key",
    "detect_key_with_confidence",
    "get_key_name",
    "get_spectral_profile",
    "match_energy",
    "match_spectral_profile",
    "normalize_energy",
    "pad_to_length",
    "soft_clip",
    "trim_silence",
]
