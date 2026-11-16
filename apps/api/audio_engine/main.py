"""
main.py — SON1KVERSE Audio Engine FastAPI Entry Point
Servidor de generación de audio gobernado por PIXEL.
Audio generation server governed by PIXEL.

Endpoints:
  POST  /generate          — Solicitar generación de audio (async con BackgroundTasks)
  GET   /status/{track_id} — Consultar estado de un track en procesamiento
  GET   /health            — Health check del sistema y VRAM
  GET   /docs              — Swagger UI automático de FastAPI
"""

import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, BackgroundTasks, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, validator

from config import ensure_directories
from orchestrator.pixel import Pixel, PixelRequest, PixelResult, PixelState
from generators.ace_step_engine import ACE_Step_Engine
from utils.logging_utils import setup_logger

logger = setup_logger("FastAPI")

# ===========================================================================
# Estado global compartido / Global shared state
# Concurrencia 1 asegurada vía threading.Lock para no saturar VRAM / KV cache
# ===========================================================================
_pixel_instance: Optional[Pixel] = None
_ace_step_engine: Optional[ACE_Step_Engine] = None
_job_store: Dict[str, Any] = {}    # track_id → {status, result}
_generation_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa PIXEL y pre-carga el modelo al iniciar el servidor."""
    global _pixel_instance, _ace_step_engine
    logger.info("🚀 SON1KVERSE Audio Engine iniciando...")
    ensure_directories()

    # Cargar ACE-Step si está disponible (motor de base extrema velocidad)
    _ace_step_engine = None
    try:
        _ace_step_engine = ACE_Step_Engine()
        if _ace_step_engine.load_model():
            logger.info("✅ ACE-Step Engine cargado como motor alternativo.")
        else:
            _ace_step_engine = None
            logger.warning("⚠️  ACE-Step no se pudo cargar. Solo HeartMuLa disponible.")
    except Exception as e:
        _ace_step_engine = None
        logger.warning(f"⚠️  ACE-Step no disponible: {e}")

    _pixel_instance = Pixel(keep_model_loaded=True, ace_step_engine=_ace_step_engine)
    # Pre-carga opcional del modelo / Optional model preload
    # _pixel_instance.preload_model()  # Descomentar para precargar en startup

    logger.info("✅ Servidor listo.")
    yield
    # Shutdown / Cleanup
    if _pixel_instance:
        _pixel_instance.unload_model()
    if _ace_step_engine:
        _ace_step_engine.unload_model()
    logger.info("🛑 Servidor detenido.")


# ===========================================================================
# FastAPI App
# ===========================================================================
app = FastAPI(
    title       = "SON1KVERSE Audio Engine",
    description = "Generación de música IA gobernada por PIXEL. Powered by HeartMuLa-oss-3B.",
    version     = "1.0.0",
    lifespan    = lifespan,
)


# ===========================================================================
# Schemas Pydantic / Request & Response Models
# ===========================================================================
class GenerateRequest(BaseModel):
    genre:            str   = Field(..., example="latin pop", description="Género musical")
    mood:             str   = Field(..., example="romantic",  description="Estado de ánimo / mood")
    language:         str   = Field(..., example="spanish",   description="Idioma de la letra")
    duration_seconds: int   = Field(..., ge=10, le=600,       description="Duración en segundos (10-600)")
    lyrics:           Optional[str]       = Field(None, description="Letra opcional")
    bpm:              Optional[int]       = Field(None, ge=40, le=250, description="BPM (auto si no se especifica)")
    title:            Optional[str]       = Field(None, description="Título del track (auto si no se especifica)")
    structure:        Optional[List[str]] = Field(None, description="Estructura personalizada ['intro','verse','chorus',...]")
    skip_mastering:   bool  = Field(False, description="Omitir cadena de mastering DSP")
    skip_analysis:    bool  = Field(False, description="Omitir análisis de métricas")
    engine:           Optional[str]       = Field("heartmula", description="Motor de generación: 'heartmula' o 'ace_step'")

    @validator("genre", "mood", "language")
    def not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("No puede estar vacío")
        return v.strip()


class JobStatus(BaseModel):
    track_id:   str
    status:     str    # "queued" | "processing" | "done" | "error"
    result:     Optional[Dict[str, Any]] = None
    error:      Optional[str]            = None


# ===========================================================================
# Background task — ejecuta el pipeline de PIXEL con concurrencia 1
# ===========================================================================
def _run_pixel_pipeline(track_id: str, request: PixelRequest):
    """
    Tarea en background: ejecuta el pipeline completo de PIXEL.
    Usa _generation_lock para garantizar ejecución secuencial (concurrencia 1).
    """
    global _job_store, _pixel_instance
    _job_store[track_id] = {"status": "queued", "result": None, "error": None}

    try:
        with _generation_lock:
            _job_store[track_id]["status"] = "processing"
            logger.info(f"[BG Task] Iniciando pipeline para track_id={track_id}")
            request.track_id = track_id
            result: PixelResult = _pixel_instance.process(request)
            if result.track_id != track_id:
                logger.error(
                    f"[BG Task] track_id divergente: job={track_id} result={result.track_id}"
                )
                result.track_id = track_id

            if result.success:
                _job_store[track_id] = {
                    "status": "done",
                    "result": result.to_dict(),
                    "error":  None,
                }
                logger.info(f"[BG Task] ✅ track_id={track_id} completado")
            else:
                _job_store[track_id] = {
                    "status": "error",
                    "result": None,
                    "error":  result.error,
                }
                logger.error(f"[BG Task] ❌ track_id={track_id} error: {result.error}")

    except Exception as e:
        logger.error(f"[BG Task] Excepción no controlada: {e}", exc_info=True)
        _job_store[track_id] = {
            "status": "error",
            "result": None,
            "error":  str(e),
        }


# ===========================================================================
# Endpoints
# ===========================================================================

@app.post(
    "/generate",
    status_code = status.HTTP_202_ACCEPTED,
    summary     = "Solicitar generación de audio",
    tags        = ["Generation"],
)
async def generate(req: GenerateRequest, background_tasks: BackgroundTasks) -> JSONResponse:
    """
    Encola una solicitud de generación de audio.
    PIXEL procesa el pipeline en background para no bloquear VRAM.

    Retorna un `track_id` que puede consultarse en `/status/{track_id}`.
    """
    global _pixel_instance
    if _pixel_instance is None:
        raise HTTPException(status_code=503, detail="PIXEL no está inicializado")

    pixel_request = PixelRequest(
        genre            = req.genre,
        mood             = req.mood,
        language         = req.language,
        duration_seconds = req.duration_seconds,
        lyrics           = req.lyrics,
        bpm              = req.bpm,
        title            = req.title,
        structure        = req.structure,
        skip_mastering   = req.skip_mastering,
        skip_analysis    = req.skip_analysis,
        engine           = req.engine,
    )

    # Un solo track_id para job_store, PIXEL y reportes de métricas
    track_id = Pixel.new_track_id(pixel_request)
    pixel_request.track_id = track_id

    # Registrar como "queued" / Register as queued
    _job_store[track_id] = {"status": "queued", "result": None, "error": None}

    # Agregar tarea en background / Add background task
    background_tasks.add_task(_run_pixel_pipeline, track_id, pixel_request)

    logger.info(f"✅ Solicitud encolada | track_id={track_id}")
    return JSONResponse(
        status_code = status.HTTP_202_ACCEPTED,
        content     = {
            "track_id":  track_id,
            "status":    "queued",
            "message":   f"Pipeline iniciado. Consulta /status/{track_id} para el progreso.",
        },
    )


@app.get(
    "/status/{track_id}",
    response_model = JobStatus,
    summary        = "Consultar estado de un track",
    tags           = ["Generation"],
)
async def get_status(track_id: str) -> JobStatus:
    """
    Retorna el estado actual de un track en procesamiento.
    Estado posibles: `queued`, `processing`, `done`, `error`.
    """
    if track_id not in _job_store:
        raise HTTPException(
            status_code = 404,
            detail      = f"track_id '{track_id}' no encontrado",
        )
    job = _job_store[track_id]
    return JobStatus(
        track_id = track_id,
        status   = job["status"],
        result   = job.get("result"),
        error    = job.get("error"),
    )


@app.get(
    "/download/{track_id}",
    summary = "Descargar el audio masterizado",
    tags    = ["Files"],
)
async def download_audio(track_id: str):
    """
    Descarga el archivo WAV masterizado de un track completado.
    Requiere que el track esté en estado `done`.
    """
    if track_id not in _job_store:
        raise HTTPException(status_code=404, detail="track_id no encontrado")

    job = _job_store[track_id]
    if job["status"] != "done":
        raise HTTPException(status_code=425, detail=f"Track aún en estado: {job['status']}")

    result = job.get("result", {})
    audio_path = result.get("mastered_audio_path") or result.get("raw_audio_path")

    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Archivo de audio no encontrado en disco")

    return FileResponse(
        path         = audio_path,
        media_type   = "audio/wav",
        filename     = f"{track_id}.wav",
    )


class ConcatenateRequest(BaseModel):
    paths:        List[str]
    output_name:  Optional[str] = None


@app.post("/concatenate", summary = "Une fragmentos WAV en una canción final")
async def concatenate(req: ConcatenateRequest):
    """
    Concatena varios WAV de fragmentos en un único archivo final con crossfade.
    Devuelve el WAV final directamente como FileResponse.
    Usado por la Orquestación de Coherencia de Pixel.
    """
    global _pixel_instance
    if _pixel_instance is None:
        raise HTTPException(status_code=503, detail="PIXEL no está inicializado")
    if not req.paths:
        raise HTTPException(status_code=400, detail="Se requiere al menos un path")
    final_path = _pixel_instance.concatenate_audio(req.paths, req.output_name)
    if not Path(final_path).exists():
        raise HTTPException(status_code=500, detail="No se pudo ensamblar la canción final")
    return FileResponse(
        path         = final_path,
        media_type   = "audio/wav",
        filename     = req.output_name or "coherent_song.wav",
    )


@app.get(
    "/health",
    summary = "Health check del sistema",
    tags    = ["System"],
)
async def health() -> JSONResponse:
    """
    Retorna el estado de salud de PIXEL, CUDA, y el modelo.
    """
    global _pixel_instance
    if _pixel_instance is None:
        return JSONResponse({"status": "degraded", "pixel": "not_initialized"})

    health_data = _pixel_instance.health_check()
    health_data["active_jobs"] = len([j for j in _job_store.values() if j["status"] == "processing"])
    health_data["queued_jobs"] = len([j for j in _job_store.values() if j["status"] == "queued"])
    health_data["completed_jobs"] = len([j for j in _job_store.values() if j["status"] == "done"])
    health_data["status"] = "ok"

    return JSONResponse(health_data)


@app.get("/", include_in_schema=False)
async def root():
    return {"service": "SON1KVERSE Audio Engine", "version": "1.0.0", "docs": "/docs"}


# ===========================================================================
# Punto de entrada CLI / CLI entry point
# ===========================================================================
if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(
        "main:app",
        # Por defecto SÓLO localhost: el motor no tiene autenticación propia y
        # la capa de seguridad vive en el backend Node (JWT en /api/v1/audio/*).
        # Expón en 0.0.0.0 únicamente detrás de un proxy con auth (o en red interna).
        host    = os.environ.get("AUDIO_ENGINE_HOST", "127.0.0.1"),
        port    = int(os.environ.get("AUDIO_ENGINE_PORT", "8001")),
        reload  = False,
        workers = 1,          # 1 worker para evitar desbordamiento de VRAM
        log_level = "info",
    )
