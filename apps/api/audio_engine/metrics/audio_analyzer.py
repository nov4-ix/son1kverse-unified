"""
metrics/audio_analyzer.py — Análisis y Validación de Audio
Genera el reporte JSON por track_id con métricas de calidad.
Generates per-track JSON quality report.

Métricas generadas / Generated metrics:
  - Spectral Centroid (Hz)
  - Spectral Bandwidth (Hz)
  - LUFS integrado final
  - Dynamic Range (dB)
  - Crest Factor (dB)
  - Stereo correlation
  - Production readiness score (0-100)
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

import numpy as np
import librosa
import pyloudnorm

from config import AUDIO_CONFIG, PATHS, MetricsReport
from utils.logging_utils import setup_logger
from utils.audio_io import load_audio

logger = setup_logger("AudioAnalyzer")


class AudioAnalyzer:
    """
    Analizador de calidad de audio.
    Llamado por PIXEL como última etapa del pipeline.
    """

    def __init__(
        self,
        sample_rate:           int   = 44100,
        target_lufs:           float = -14.0,
        production_threshold:  float = 70.0,
    ):
        self.sample_rate          = sample_rate
        self.target_lufs          = target_lufs
        self.production_threshold = production_threshold
        logger.info(f"AudioAnalyzer inicializado | SR={sample_rate} | target={target_lufs} LUFS")

    # ------------------------------------------------------------------
    # Método principal — llamado por PIXEL
    # ------------------------------------------------------------------
    def analyze(
        self,
        audio_path: Path,
        track_id:   str,
        song_params:         Dict[str, Any],
        generation_metrics:  Dict[str, Any],
        processing_metrics:  Optional[Dict[str, Any]] = None,
    ) -> MetricsReport:
        """
        Analiza un archivo de audio y genera un MetricsReport completo.

        Args:
            audio_path:          Ruta al audio masterizado
            track_id:            ID único del track (asignado por PIXEL)
            song_params:         Parámetros originales de la canción
            generation_metrics:  Métricas de HeartMuLaEngine
            processing_metrics:  Métricas de MasteringChain (opcional)

        Returns:
            MetricsReport con todas las métricas y el JSON guardado
        """
        logger.info(f"Analizando audio: {audio_path} | track_id={track_id}")

        audio, sr = load_audio(Path(audio_path), self.sample_rate)

        # Audio mono para análisis espectral
        mono = np.mean(audio, axis=0) if audio.ndim == 2 else audio

        audio_metrics = {
            **self._spectral_metrics(mono),
            **self._loudness_metrics(audio, mono),
            **self._dynamic_metrics(mono),
            **self._stereo_metrics(audio),
            "production_ready":  False,   # se calcula abajo
            "quality_score":     0.0,
        }

        quality_score = self._calculate_quality_score(audio_metrics)
        audio_metrics["quality_score"]    = round(quality_score, 2)
        audio_metrics["production_ready"] = quality_score >= self.production_threshold

        performance_metrics = {
            "generation_time_s": generation_metrics.get("generation_time", 0),
            "vram_used_mb":      generation_metrics.get("vram_used_mb", 0),
            "sections_count":    generation_metrics.get("sections_count", 0),
        }

        report = MetricsReport(
            track_id            = track_id,
            song_params         = song_params,
            generation_metrics  = generation_metrics,
            audio_metrics       = audio_metrics,
            performance_metrics = performance_metrics,
            timestamp           = datetime.now(timezone.utc).isoformat(),
        )

        # Guardar JSON / Save JSON report
        self._save_report(report)

        logger.info(f"✅ Análisis completado | Score: {quality_score:.1f}/100 | "
                    f"Production ready: {audio_metrics['production_ready']}")
        return report

    # ------------------------------------------------------------------
    # Spectral metrics
    # ------------------------------------------------------------------
    def _spectral_metrics(self, mono: np.ndarray) -> Dict[str, float]:
        centroid   = librosa.feature.spectral_centroid(y=mono, sr=self.sample_rate)
        bandwidth  = librosa.feature.spectral_bandwidth(y=mono,  sr=self.sample_rate)
        rolloff    = librosa.feature.spectral_rolloff(y=mono,    sr=self.sample_rate)
        flatness   = librosa.feature.spectral_flatness(y=mono)
        zcr        = librosa.feature.zero_crossing_rate(y=mono)

        return {
            "spectral_centroid_hz":   float(np.mean(centroid)),
            "spectral_bandwidth_hz":  float(np.mean(bandwidth)),
            "spectral_rolloff_hz":    float(np.mean(rolloff)),
            "spectral_flatness":      float(np.mean(flatness)),
            "zero_crossing_rate":     float(np.mean(zcr)),
        }

    # ------------------------------------------------------------------
    # Loudness metrics
    # ------------------------------------------------------------------
    def _loudness_metrics(self, audio: np.ndarray, mono: np.ndarray) -> Dict[str, float]:
        meter = pyloudnorm.Meter(self.sample_rate)
        audio_for_meter = audio.T if audio.ndim == 2 else audio.reshape(-1, 1)

        try:
            lufs = meter.integrated_loudness(audio_for_meter)
            if np.isinf(lufs) or np.isnan(lufs):
                lufs = -70.0
        except Exception:
            lufs = -70.0

        true_peak    = float(20 * np.log10(np.max(np.abs(audio)) + 1e-9))
        lufs_diff    = abs(lufs - self.target_lufs)

        return {
            "lufs_integrated":  float(lufs),
            "lufs_target":      self.target_lufs,
            "lufs_difference":  float(lufs_diff),
            "true_peak_db":     true_peak,
            "lufs_compliant":   lufs_diff <= 1.0,
        }

    # ------------------------------------------------------------------
    # Dynamic metrics
    # ------------------------------------------------------------------
    def _dynamic_metrics(self, mono: np.ndarray) -> Dict[str, float]:
        rms        = librosa.feature.rms(y=mono)
        rms_mean   = float(np.mean(rms))
        rms_std    = float(np.std(rms))
        peak       = float(np.max(np.abs(mono)))

        # Dynamic Range
        if rms_mean > 0:
            dr_db = float(20 * np.log10((rms_mean + rms_std) / (rms_mean - rms_std + 1e-9)))
        else:
            dr_db = 0.0

        # Crest Factor
        crest_db = float(20 * np.log10(peak / (rms_mean + 1e-9)))

        return {
            "dynamic_range_db": dr_db,
            "crest_factor_db":  crest_db,
            "rms_mean":         rms_mean,
            "peak_amplitude":   peak,
        }

    # ------------------------------------------------------------------
    # Stereo metrics
    # ------------------------------------------------------------------
    def _stereo_metrics(self, audio: np.ndarray) -> Dict[str, Any]:
        if audio.ndim != 2 or audio.shape[0] != 2:
            return {"stereo": False, "channel_correlation": 1.0, "ms_width_ratio": 0.0}

        left, right   = audio[0], audio[1]
        correlation   = float(np.corrcoef(left, right)[0, 1])
        mid           = (left + right) / 2
        side          = (left - right) / 2
        mid_energy    = float(np.sum(mid  ** 2))
        side_energy   = float(np.sum(side ** 2))
        width_ratio   = float(side_energy / (mid_energy + 1e-9))

        return {
            "stereo":              True,
            "channel_correlation": correlation,
            "ms_width_ratio":      width_ratio,
        }

    # ------------------------------------------------------------------
    # Puntuación de calidad
    # ------------------------------------------------------------------
    def _calculate_quality_score(self, metrics: Dict[str, Any]) -> float:
        """Calcula un score 0-100 ponderado a partir de las métricas."""
        scores = []

        # 1. LUFS compliance (peso 30)
        lufs_diff    = metrics.get("lufs_difference", 10.0)
        lufs_score   = max(0.0, 100.0 - lufs_diff * 15)
        scores.append((lufs_score, 0.30))

        # 2. Spectral balance (peso 20)
        centroid     = metrics.get("spectral_centroid_hz", 2000.0)
        cent_score   = max(0.0, 100.0 - abs(centroid - 2000) / 50)
        scores.append((cent_score, 0.20))

        # 3. Dynamic range (peso 20) — target ~8 dB
        dr           = metrics.get("dynamic_range_db", 8.0)
        dr_score     = max(0.0, 100.0 - abs(dr - 8.0) * 5)
        scores.append((dr_score, 0.20))

        # 4. True peak (peso 15)
        tp           = metrics.get("true_peak_db", -1.0)
        tp_score     = 100.0 if tp <= -1.0 else max(0.0, 100.0 - (tp + 1.0) * 50)
        scores.append((tp_score, 0.15))

        # 5. Stereo width (peso 15)
        width        = metrics.get("ms_width_ratio", 0.3)
        width_score  = max(0.0, 100.0 - abs(width - 0.3) * 200)
        scores.append((width_score, 0.15))

        total_weight = sum(w for _, w in scores)
        weighted_sum = sum(s * w for s, w in scores)
        return weighted_sum / total_weight if total_weight > 0 else 0.0

    # ------------------------------------------------------------------
    # Guardar reporte JSON
    # ------------------------------------------------------------------
    def _save_report(self, report: MetricsReport) -> Path:
        report_dir = Path(PATHS["reports_output"])
        report_dir.mkdir(parents=True, exist_ok=True)
        path = report_dir / f"{report.track_id}_report.json"

        payload = {
            "track_id":           report.track_id,
            "timestamp":          report.timestamp,
            "song_params":        report.song_params,
            "generation_metrics": report.generation_metrics,
            "audio_metrics":      report.audio_metrics,
            "performance":        report.performance_metrics,
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False, default=str)

        logger.info(f"📊 Reporte guardado: {path}")
        return path


# ---------------------------------------------------------------------------
# Helper de módulo
# ---------------------------------------------------------------------------
def analyze_audio(
    audio_path:         Path,
    track_id:           str,
    song_params:        Dict[str, Any],
    generation_metrics: Dict[str, Any],
    processing_metrics: Optional[Dict[str, Any]] = None,
) -> MetricsReport:
    """Atajo de módulo para crear un AudioAnalyzer y analizar."""
    return AudioAnalyzer(sample_rate=AUDIO_CONFIG["sample_rate"]).analyze(
        audio_path, track_id, song_params, generation_metrics, processing_metrics
    )
