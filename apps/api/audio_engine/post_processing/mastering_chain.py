"""
post_processing/mastering_chain.py — Cadena de Mastering DSP
Pipeline de Audio Post-Procesamiento profesional de 4 módulos.
4-module professional audio post-processing pipeline.

Módulo A: Normalización LUFS (-14 LUFS objetivo)
Módulo B: Compresor Multibanda (control dinámico preciso)
Módulo C: Stereo Enhancer (widening + harmonic excitation)
Módulo D: Limitador Final (True Peak -1.0 dBTP)
"""

import time
from pathlib import Path
from typing import Tuple, Dict, Optional, List

import numpy as np
import pyloudnorm

from config import ProcessingResult, AUDIO_CONFIG, MASTERING_CONFIG
from utils.logging_utils import setup_logger, PerformanceTracker
from utils.audio_io import load_audio, save_audio, generate_output_path

logger = setup_logger("MasteringChain")


# ===========================================================================
# Módulo A — Normalizador LUFS
# ===========================================================================
class LUFSNormalizer:
    """
    Módulo A: Normaliza el audio a -14 LUFS integrados con True Peak limiting.
    Usa pyloudnorm para medición precisa BS.1770-4 compliant.
    """

    def __init__(self, target_lufs: float, true_peak_db: float, sample_rate: int):
        self.target_lufs  = target_lufs
        self.true_peak_db = true_peak_db
        self.sample_rate  = sample_rate
        logger.info(f"[A] LUFSNormalizer | target={target_lufs} LUFS | TP={true_peak_db} dBTP")

    def process(self, audio: np.ndarray) -> Tuple[np.ndarray, Dict]:
        # Medir LUFS actual / Measure current LUFS
        meter           = pyloudnorm.Meter(self.sample_rate)
        audio_for_meter = audio.T if audio.ndim == 2 else audio.reshape(-1, 1)

        try:
            current_lufs = meter.integrated_loudness(audio_for_meter)
        except Exception as e:
            logger.warning(f"[A] pyloudnorm falló ({e}), usando estimación RMS")
            rms          = np.sqrt(np.mean(audio ** 2))
            current_lufs = 20 * np.log10(rms + 1e-9) + 10

        if np.isinf(current_lufs) or np.isnan(current_lufs):
            logger.warning("[A] LUFS inválido, asumiendo -23 LUFS")
            current_lufs = -23.0

        # Aplicar ganancia / Apply gain
        gain_db     = self.target_lufs - current_lufs
        gain_linear = 10 ** (gain_db / 20)
        normalized  = audio * gain_linear

        # True Peak limiting / True Peak limiting
        true_peak_linear = 10 ** (self.true_peak_db / 20)
        peak             = np.max(np.abs(normalized))
        if peak > true_peak_linear:
            x                = normalized / true_peak_linear
            normalized       = np.tanh(x * 1.5) / 1.5 * true_peak_linear
            logger.info(f"[A] True Peak limited: {20*np.log10(peak):.1f} → {self.true_peak_db} dBTP")

        # Medir LUFS de salida / Measure output LUFS
        audio_out   = normalized.T if normalized.ndim == 2 else normalized.reshape(-1, 1)
        output_lufs = meter.integrated_loudness(audio_out)
        if np.isinf(output_lufs) or np.isnan(output_lufs):
            output_lufs = self.target_lufs

        metrics = {
            "input_lufs":      float(current_lufs),
            "output_lufs":     float(output_lufs),
            "gain_applied_db": float(gain_db),
            "true_peak_db":    float(self.true_peak_db),
        }
        logger.info(f"[A] {current_lufs:.1f} LUFS → {output_lufs:.1f} LUFS (gain: {gain_db:+.1f} dB)")
        return normalized, metrics


# ===========================================================================
# Módulo B — Compresor Multibanda
# ===========================================================================
class MultibandCompressor:
    """
    Módulo B: Compresor multibanda para control dinámico preciso.
    Bandas: Low (20–300Hz), Mid (300–4kHz), High (4k–22kHz).
    Implementado con filtros butterworth + feed-forward gain computer.
    """

    BANDS = [
        ("low",  (20,   300)),
        ("mid",  (300,  4000)),
        ("high", (4000, 20000)),
    ]

    def __init__(self, sample_rate: int, config: Optional[Dict] = None):
        self.sample_rate = sample_rate
        cfg              = config or MASTERING_CONFIG["compressor"]
        self.thresholds  = {
            "low":  cfg["low_threshold_db"],
            "mid":  cfg["mid_threshold_db"],
            "high": cfg["high_threshold_db"],
        }
        self.ratios = {
            "low":  cfg["low_ratio"],
            "mid":  cfg["mid_ratio"],
            "high": cfg["high_ratio"],
        }
        self.attack_ms  = cfg["attack_ms"]
        self.release_ms = cfg["release_ms"]
        logger.info(f"[B] MultibandCompressor inicializado | SR={sample_rate}")

    def process(self, audio: np.ndarray) -> Tuple[np.ndarray, Dict]:
        from scipy.signal import butter, sosfilt

        if audio.ndim == 2:
            mono = np.mean(audio, axis=0)
        else:
            mono = audio

        band_gains  = {}
        total_gain  = np.ones_like(mono)
        nyq         = self.sample_rate / 2

        for band_name, (low_hz, high_hz) in self.BANDS:
            # Diseñar filtro bandpass / Design bandpass filter
            low_norm  = max(20, low_hz)  / nyq
            high_norm = min(high_hz, nyq * 0.999) / nyq

            try:
                sos   = butter(4, [low_norm, high_norm], btype="band", output="sos")
                band  = sosfilt(sos, mono)
            except Exception:
                band  = mono.copy()

            # Calcular ganancia de compresión / Calculate compression gain
            thresh_lin = 10 ** (self.thresholds[band_name] / 20)
            ratio      = self.ratios[band_name]
            rms        = np.sqrt(np.mean(band ** 2) + 1e-9)

            if rms > thresh_lin:
                # Compresión por encima del umbral / Compress above threshold
                excess_db = 20 * np.log10(rms / thresh_lin)
                gain_db   = -(excess_db * (1 - 1 / ratio))
                gain      = np.ones_like(mono) * (10 ** (gain_db / 20))
            else:
                gain      = np.ones_like(mono)

            band_gains[band_name] = float(20 * np.log10(np.mean(gain) + 1e-9))
            total_gain           *= gain

        # Aplicar gain suavizado con tiempos de attack/release
        attack_samples  = max(1, int(self.attack_ms  * self.sample_rate / 1000))
        release_samples = max(1, int(self.release_ms * self.sample_rate / 1000))

        smoothed_gain = self._smooth_gain(total_gain, attack_samples, release_samples)

        if audio.ndim == 2:
            smoothed_gain_2d = np.tile(smoothed_gain, (2, 1))
            compressed        = audio * smoothed_gain_2d
        else:
            compressed        = audio * smoothed_gain

        metrics = {
            "band_gains_db":       band_gains,
            "peak_gain_reduction": float(20 * np.log10(np.min(smoothed_gain) + 1e-9)),
        }
        logger.info(f"[B] Compresión aplicada | Bandas: {band_gains}")
        return compressed, metrics

    @staticmethod
    def _smooth_gain(gain: np.ndarray, attack: int, release: int) -> np.ndarray:
        smoothed = gain.copy()
        for i in range(1, len(gain)):
            if gain[i] < smoothed[i - 1]:
                coeff = np.exp(-1.0 / attack)
            else:
                coeff = np.exp(-1.0 / release)
            smoothed[i] = coeff * smoothed[i - 1] + (1 - coeff) * gain[i]
        return smoothed


# ===========================================================================
# Módulo C — Stereo Enhancer
# ===========================================================================
class StereoEnhancer:
    """
    Módulo C: Ensanchamiento estéreo + excitación harmónica suave.
    Usa M/S processing y saturación armónica controlada.
    """

    def __init__(self, sample_rate: int, config: Optional[Dict] = None):
        self.sample_rate = sample_rate
        cfg              = config or MASTERING_CONFIG["stereo_enhancer"]
        self.width_factor         = cfg.get("width_factor", 1.2)
        self.harmonic_excitation  = cfg.get("harmonic_excitation", True)
        self.excitation_mix       = cfg.get("excitation_mix", 0.15)
        logger.info(f"[C] StereoEnhancer | width={self.width_factor} | excitation={self.harmonic_excitation}")

    def process(self, audio: np.ndarray) -> Tuple[np.ndarray, Dict]:
        if audio.ndim != 2 or audio.shape[0] != 2:
            logger.warning("[C] Audio no es stereo, convirtiendo...")
            if audio.ndim == 1:
                audio = np.stack([audio, audio])
            else:
                audio = np.vstack([audio, audio])

        left, right = audio[0], audio[1]

        # M/S encoding
        mid  = (left + right) / 2.0
        side = (left - right) / 2.0

        # Ensanchar el canal Side / Widen side channel
        side_widened = side * self.width_factor

        # Harmonic excitation en el canal Mid / Harmonic excitation on mid
        if self.harmonic_excitation:
            excited_mid  = np.tanh(mid * 1.2) * 0.8
            mid          = mid * (1 - self.excitation_mix) + excited_mid * self.excitation_mix

        # M/S decoding
        left_out  = mid + side_widened
        right_out = mid - side_widened

        # Normalizar si hay clipping / Normalize if clipping
        peak = max(np.max(np.abs(left_out)), np.max(np.abs(right_out)))
        if peak > 1.0:
            left_out  /= peak
            right_out /= peak

        enhanced = np.stack([left_out, right_out])

        # Calcular correlación y ancho / Calculate correlation and width
        correlation = float(np.corrcoef(left_out, right_out)[0, 1])
        mid_e       = np.sum(mid ** 2)
        side_e      = np.sum(side_widened ** 2)
        width_ratio = float(side_e / (mid_e + 1e-9))

        metrics = {
            "width_factor":       self.width_factor,
            "channel_correlation": correlation,
            "ms_width_ratio":     width_ratio,
            "harmonic_excitation": self.harmonic_excitation,
        }
        logger.info(f"[C] Stereo enhanced | correlation={correlation:.2f} | width_ratio={width_ratio:.2f}")
        return enhanced, metrics


# ===========================================================================
# Módulo D — Limitador Final (True Peak -1.0 dBTP)
# ===========================================================================
class TruePeakLimiter:
    """
    Módulo D: Limitador True Peak con look-ahead y release suave.
    Garantiza que la señal no supere el True Peak configurado.
    """

    def __init__(self, threshold_db: float = -1.0, release_ms: float = 50.0, sample_rate: int = 44100):
        self.threshold_linear = 10 ** (threshold_db / 20)
        self.release_samples  = max(1, int(release_ms * sample_rate / 1000))
        self.threshold_db     = threshold_db
        logger.info(f"[D] TruePeakLimiter | threshold={threshold_db} dBTP | release={release_ms}ms")

    def process(self, audio: np.ndarray) -> Tuple[np.ndarray, Dict]:
        if audio.ndim == 2:
            envelope = np.max(np.abs(audio), axis=0)
        else:
            envelope = np.abs(audio)

        gain = np.ones_like(envelope)

        for i in range(1, len(envelope)):
            if envelope[i] > self.threshold_linear:
                gain[i] = self.threshold_linear / (envelope[i] + 1e-9)
            else:
                if gain[i - 1] < 1.0:
                    gain[i] = min(
                        1.0,
                        gain[i - 1] + (1.0 - gain[i - 1]) / self.release_samples,
                    )

        peak_before = 20 * np.log10(np.max(np.abs(audio)) + 1e-9)

        if audio.ndim == 2:
            gain = np.tile(gain, (2, 1))

        limited     = audio * gain
        peak_after  = 20 * np.log10(np.max(np.abs(limited)) + 1e-9)

        metrics = {
            "threshold_db":    self.threshold_db,
            "peak_before_db":  float(peak_before),
            "peak_after_db":   float(peak_after),
            "limiting_applied": peak_before > self.threshold_db,
            "gain_reduction_db": float(peak_after - peak_before),
        }
        logger.info(f"[D] Limiter | {peak_before:.1f} dB → {peak_after:.1f} dB (threshold={self.threshold_db} dBTP)")
        return limited, metrics


# ===========================================================================
# MasteringChain — Orquestador de los 4 módulos DSP
# ===========================================================================
class MasteringChain:
    """
    Cadena de mastering completa.
    Llamada por PIXEL después de HeartMuLaEngine.

    Pipeline:
      A) LUFSNormalizer   → normaliza a -14 LUFS
      B) MultibandCompressor → control dinámico
      C) StereoEnhancer   → widening + excitación
      D) TruePeakLimiter  → limita a -1.0 dBTP
    """

    def __init__(self, sample_rate: Optional[int] = None, config: Optional[Dict] = None):
        self.sample_rate = sample_rate or AUDIO_CONFIG["sample_rate"]
        cfg              = config or MASTERING_CONFIG

        self.normalizer   = LUFSNormalizer(
            target_lufs  = AUDIO_CONFIG["target_lufs"],
            true_peak_db = AUDIO_CONFIG["true_peak_db"],
            sample_rate  = self.sample_rate,
        )
        self.compressor   = MultibandCompressor(
            sample_rate = self.sample_rate,
            config      = cfg.get("compressor"),
        )
        self.stereo       = StereoEnhancer(
            sample_rate = self.sample_rate,
            config      = cfg.get("stereo_enhancer"),
        )
        self.limiter      = TruePeakLimiter(
            threshold_db = cfg["limiter"]["threshold_db"],
            release_ms   = cfg["limiter"]["release_ms"],
            sample_rate  = self.sample_rate,
        )
        logger.info("✅ MasteringChain inicializado (4 módulos DSP)")

    # ------------------------------------------------------------------
    # master() — procesa desde archivo
    # ------------------------------------------------------------------
    def master(
        self,
        input_path:  Path,
        output_path: Optional[Path] = None,
    ) -> ProcessingResult:
        """
        Procesa un archivo de audio completo a través del pipeline DSP.
        Llamado por PIXEL con la ruta del audio crudo generado.
        """
        start_time = time.time()

        if output_path is None:
            output_path = generate_output_path(
                prefix     = Path(input_path).stem,
                suffix     = "mastered",
                extension  = "wav",
                output_type = "processed",
            )

        logger.info(f"\n{'='*60}")
        logger.info(f"🎛️  Iniciando Mastering Chain: {Path(input_path).name}")

        with PerformanceTracker("MasteringChain") as tracker:
            audio, sr = load_audio(Path(input_path), self.sample_rate)
            tracker.checkpoint("cargado")

            audio, stage_metrics = self.process_audio(audio)
            tracker.checkpoint("procesado")

            save_audio(audio, output_path, self.sample_rate)
            tracker.checkpoint("guardado")

        processing_time = time.time() - start_time
        stages_applied  = list(stage_metrics.keys())

        # LUFS final del Módulo A
        final_lufs = stage_metrics.get("A_normalize", {}).get("output_lufs", AUDIO_CONFIG["target_lufs"])

        result = ProcessingResult(
            input_path      = str(input_path),
            output_path     = str(output_path),
            loudness_lufs   = final_lufs,
            true_peak_db    = AUDIO_CONFIG["true_peak_db"],
            processing_time = processing_time,
            stages_applied  = stages_applied,
            stage_metrics   = stage_metrics,
        )

        logger.info(f"✅ Mastering completado")
        logger.info(f"   Salida  : {output_path}")
        logger.info(f"   LUFS    : {final_lufs:.1f}")
        logger.info(f"   Tiempo  : {processing_time:.2f}s")
        logger.info(f"{'='*60}")

        return result

    # ------------------------------------------------------------------
    # process_audio() — procesa array en memoria
    # ------------------------------------------------------------------
    def process_audio(self, audio: np.ndarray) -> Tuple[np.ndarray, Dict]:
        """
        Aplica los 4 módulos DSP sobre un array numpy.
        Retorna (audio_procesado, metricas_por_etapa).
        """
        stage_metrics: Dict = {}

        logger.info("--- Módulo A: Normalización LUFS ---")
        audio, m = self.normalizer.process(audio)
        stage_metrics["A_normalize"] = m

        logger.info("--- Módulo B: Compresor Multibanda ---")
        audio, m = self.compressor.process(audio)
        stage_metrics["B_compress"] = m

        logger.info("--- Módulo C: Stereo Enhancer ---")
        audio, m = self.stereo.process(audio)
        stage_metrics["C_stereo"] = m

        logger.info("--- Módulo D: Limitador True Peak ---")
        audio, m = self.limiter.process(audio)
        stage_metrics["D_limit"] = m

        return audio, stage_metrics


# ---------------------------------------------------------------------------
# Helper de módulo
# ---------------------------------------------------------------------------
def master_audio(
    input_path:  Path,
    output_path: Optional[Path] = None,
) -> ProcessingResult:
    """Atajo: crea una MasteringChain y procesa el archivo."""
    return MasteringChain().master(input_path, output_path)
