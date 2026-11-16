"""
SON1KVERSE Audio Engine — Configuración Central / Central Configuration
Todos los parámetros del sistema definidos aquí.
All system parameters defined here.
"""

import os
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import torch

# ---------------------------------------------------------------------------
# Rutas / Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent.absolute()
OUTPUTS_DIR = BASE_DIR / "outputs"

PATHS = {
    "raw_output": OUTPUTS_DIR / "raw",
    "processed_output": OUTPUTS_DIR / "processed",
    "reports_output": OUTPUTS_DIR / "reports",
}

# ---------------------------------------------------------------------------
# Modelo HeartMuLa + HeartCodec (heartlib)
# Layout esperado de HEARTMULA_CKPT_DIR:
#   ckpt/
#     HeartCodec-oss/          ← HeartMuLa/HeartCodec-oss-20260123
#     HeartMuLa-oss-3B/        ← HeartMuLa/HeartMuLa-oss-3B-happy-new-year
#     gen_config.json          ← HeartMuLa/HeartMuLaGen
#     tokenizer.json           ← HeartMuLa/HeartMuLaGen
# ---------------------------------------------------------------------------
HEARTMULA_CKPT_DIR = Path(
    os.environ.get("HEARTMULA_CKPT_DIR", str(BASE_DIR / "ckpt"))
)
HEARTMULA_VERSION = os.environ.get("HEARTMULA_VERSION", "3B")
HEARTMULA_GEN_REPO = "HeartMuLa/HeartMuLaGen"
HEARTMULA_MODEL_REPO = "HeartMuLa/HeartMuLa-oss-3B-happy-new-year"
HEARTCODEC_REPO = "HeartMuLa/HeartCodec-oss-20260123"
HEARTMULA_MODEL_NAME = HEARTMULA_MODEL_REPO  # compat / logs
HEARTMULA_LAZY_LOAD = os.environ.get("HEARTMULA_LAZY_LOAD", "1") not in ("0", "false", "False")
HEARTMULA_AUTO_DOWNLOAD = os.environ.get("HEARTMULA_AUTO_DOWNLOAD", "0") in ("1", "true", "True")
HEARTMULA_CFG_SCALE = float(os.environ.get("HEARTMULA_CFG_SCALE", "1.5"))
HEARTMULA_MULA_DTYPE = os.environ.get("HEARTMULA_MULA_DTYPE", "bfloat16")
HEARTMULA_CODEC_DTYPE = os.environ.get("HEARTMULA_CODEC_DTYPE", "float32")
HEARTCODEC_SAMPLE_RATE = 48000
HEARTMULA_DEVICE_MAP = "auto"          # legado; el pipeline usa mula/codec device
HEARTMULA_TORCH_DTYPE = HEARTMULA_MULA_DTYPE

# ---------------------------------------------------------------------------
# Audio / DSP
# ---------------------------------------------------------------------------
AUDIO_CONFIG = {
    "sample_rate": 44100,
    "bit_depth": 24,
    "channels": 2,
    "target_lufs": -14.0,   # Módulo A: normalización LUFS objetivo
    "true_peak_db": -1.0,   # Módulo D: True Peak -1.0 dBTP
}

# ---------------------------------------------------------------------------
# Generación / Generation
# ---------------------------------------------------------------------------
GENERATION_CONFIG = {
    "temperature": 1.0,
    "top_k": 50,
    "cfg_scale": HEARTMULA_CFG_SCALE,
}

# ---------------------------------------------------------------------------
# Orquestación de Coherencia de Pixel — Canciones completas por bloques
# ---------------------------------------------------------------------------
MAX_FRAGMENT_DURATION_SECONDS = 30     # ventana máxima por fragmento (30s para reducir overhead)
SEED_OVERLAP_SECONDS = 3.0             # solapamiento de semilla entre bloques (3s para continuidad)
COHERENT_CROSSFADE_SAMPLES = 13230     # 300ms @ 44100 Hz entre bloques (crossfade más suave)

# ---------------------------------------------------------------------------
# Estructura de secciones / Section structure
# ---------------------------------------------------------------------------
SECTION_TEMPLATES = {
    "intro":       {"energy": 0.4, "typical_duration_ratio": 0.08},
    "verse":       {"energy": 0.6, "typical_duration_ratio": 0.20},
    "chorus":      {"energy": 0.9, "typical_duration_ratio": 0.25},
    "bridge":      {"energy": 0.7, "typical_duration_ratio": 0.12},
    "outro":       {"energy": 0.3, "typical_duration_ratio": 0.10},
    "pre_chorus":  {"energy": 0.7, "typical_duration_ratio": 0.10},
    "post_chorus": {"energy": 0.8, "typical_duration_ratio": 0.08},
}

DEFAULT_SONG_STRUCTURE = [
    "intro", "verse", "chorus",
    "verse", "chorus", "bridge",
    "chorus", "outro",
]

# ---------------------------------------------------------------------------
# Cadena de mastering / Mastering chain
# Módulo B: Multiband Compressor
# Módulo C: Stereo Enhancer
# Módulo D: Final Limiter
# ---------------------------------------------------------------------------
MASTERING_CONFIG = {
    "compressor": {
        "low_threshold_db":  -20,
        "low_ratio":          3.0,
        "mid_threshold_db":  -18,
        "mid_ratio":          2.5,
        "high_threshold_db": -16,
        "high_ratio":         2.0,
        "attack_ms":         10.0,
        "release_ms":       100.0,
    },
    "stereo_enhancer": {
        "width_factor":        1.2,
        "harmonic_excitation": True,
        "excitation_mix":      0.15,
    },
    "limiter": {
        "threshold_db": -1.0,
        "release_ms":   50.0,
    },
}

# ---------------------------------------------------------------------------
# Reintentos / Retry policy (controlado por PIXEL)
# ---------------------------------------------------------------------------
PIXEL_RETRY_CONFIG = {
    "max_retries":    3,
    "retry_delay_s":  2.0,   # seconds between retries
}

# ---------------------------------------------------------------------------
# Celery / Redis (concurrencia async)
# ---------------------------------------------------------------------------
CELERY_BROKER_URL  = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class SongParams:
    """Parámetros de entrada para generación de una canción."""
    genre:            str
    mood:             str
    language:         str
    duration_seconds: int
    lyrics:           Optional[str]       = None
    bpm:              Optional[int]       = None
    title:            Optional[str]       = None
    structure:        Optional[List[str]] = None
    # Selección de motor de generación (Fase 2 - ACE-Step)
    engine:           Optional[str]       = None  # 'heartmula' o 'ace_step'

    def __post_init__(self):
        if self.structure is None:
            self.structure = DEFAULT_SONG_STRUCTURE.copy()
        if self.bpm is None:
            self.bpm = self._estimate_bpm()
        if self.title is None:
            self.title = f"{self.genre}_{self.mood}_{self.duration_seconds}s"

    def _estimate_bpm(self) -> int:
        genre_bpm = {
            "latin pop": 110, "pop": 120, "rock": 130,
            "hip hop": 90, "electronic": 128, "jazz": 100,
            "classical": 80, "r&b": 95, "country": 110,
            "reggae": 75, "edm": 128, "house": 125,
        }
        genre_lower = self.genre.lower()
        for key, bpm in genre_bpm.items():
            if key in genre_lower:
                return bpm
        return 120


@dataclass
class Section:
    """Sección estructural de la canción (intro, verse, chorus…)."""
    name:          str
    start_time:    float
    duration:      float
    energy:        float
    prompt_suffix: str = ""


@dataclass
class GenerationResult:
    """Resultado de la generación de audio crudo."""
    audio_path:       str
    duration:         float
    sample_rate:      int
    sections:         List[Section]
    generation_time:  float
    vram_used_mb:     float
    metadata:         Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProcessingResult:
    """Resultado de la cadena de mastering."""
    input_path:       str
    output_path:      str
    loudness_lufs:    float
    true_peak_db:     float
    processing_time:  float
    stages_applied:   List[str]
    stage_metrics:    Dict[str, Any] = field(default_factory=dict)


@dataclass
class MetricsReport:
    """Reporte JSON de métricas por track_id."""
    track_id:             str
    song_params:          Dict[str, Any]
    generation_metrics:   Dict[str, Any]
    audio_metrics:        Dict[str, Any]
    performance_metrics:  Dict[str, Any]
    timestamp:            str


# ---------------------------------------------------------------------------
# Helpers de inicialización
# ---------------------------------------------------------------------------
def get_device() -> torch.device:
    if torch.cuda.is_available():
        device = torch.device("cuda")
        print(f"[Config] ✅ CUDA disponible: {torch.cuda.get_device_name(0)}")
        print(f"[Config] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
    else:
        device = torch.device("cpu")
        print("[Config] ⚠️  CUDA no disponible, usando CPU")
    return device


def ensure_directories():
    """Crea directorios de salida si no existen."""
    for path in PATHS.values():
        Path(path).mkdir(parents=True, exist_ok=True)
        print(f"[Config] 📁 Directorio listo: {path}")


DEVICE = get_device()
