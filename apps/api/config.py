"""
SON1KVERSE AUDIO ENGINE - GLOBAL CONFIGURATION
Optimized for: Google Cloud Platform (GCP) | NVIDIA T4 GPU
Target: Maximum Throughput & Low Latency
"""

import torch
import os

# ==============================================================================
# 1. HARDWARE & DEVICE CONFIGURATION
# ==============================================================================
# Forzamos CUDA ya que estamos en la nube. Si falla, el sistema hará fallback a CPU.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
PRECISION = torch.bfloat16 if torch.cuda.is_available() else torch.float32

# Optimización de Memoria VRAM
# cuda_eff_cache_empty: Limpia la caché de GPU entre generaciones para evitar OOM
CUDA_EFF_CACHE_EMPTY = True 
# lazy_load: Carga el modelo solo cuando es solicitado
LAZY_LOAD_MODELS = True

# ==============================================================================
# 2. MODEL PATHS (Ajustados para estructura de Linux en VM)
# ==============================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CKPT_DIR = os.path.join(BASE_DIR, "ckpt")

# Rutas específicas a los modelos
HEARTMULA_PATH = os.path.join(CKPT_DIR, "HeartMuLa-oss-3B")
HEARTCODEC_PATH = os.path.join(CKPT_DIR, "HeartCodec-oss")
ACE_STEP_PATH   = os.path.join(CKPT_DIR, "ACE-Step")

# ==============================================================================
# 3. PIPELINE SETTINGS (PIXEL & Engines)
# ==============================================================================
# Pixel Settings
PIXEL_MAX_RETRIES = 3
PIXEL_RETRY_DELAY = 2.0
KEEP_MODELS_LOADED = True  # En la nube tenemos VRAM, mantenemos el modelo listo

# Generación
DEFAULT_SAMPLE_RATE = 44100
MAX_GEN_DURATION = 60  # Segundos máximos por track para evitar overflows
DEFAULT_DURATION = 10

# ==============================================================================
# 4. STORAGE & OUTPUTS
# ==============================================================================
OUTPUTS_DIR = os.path.join(BASE_DIR, "outputs")
PATHS = {
    "raw": os.path.join(OUTPUTS_DIR, "raw"),
    "processed": os.path.join(OUTPUTS_DIR, "processed"),
    "reports": os.path.join(OUTPUTS_DIR, "reports"),
}

# Crear carpetas automáticamente si no existen
for path in PATHS.values():
    os.makedirs(path, exist_ok=True)

# ==============================================================================
# 5. API & NETWORK (Para FastAPI)
# ==============================================================================
API_HOST = "0.0.0.0"
API_PORT = 8001
WORKERS = 1  # Con GPUs, 1 worker es lo ideal para evitar conflictos de memoria VRAM

# ==============================================================================
# 6. LOGGING & DEBUG
# ==============================================================================
LOG_LEVEL = "INFO"
DEBUG_MODE = False

print(f"\n[Config] ✅ SON1KVERSE Config Loaded Successfully")
print(f"[Config] 🚀 Device: {DEVICE.upper()} | Precision: {PRECISION}")
print(f"[Config] 📁 Checkpoint Dir: {CKPT_DIR}")
print(f"[Config] 🌐 API Endpoint: http://{API_HOST}:{API_PORT}\n")