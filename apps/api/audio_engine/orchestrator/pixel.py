"""
orchestrator/pixel.py — PIXEL: El Cerebro del Sistema SON1KVERSE Audio Engine
Central Orchestrator for the HeartMuLa Audio Generation Pipeline.

PIXEL is the single entry point. Nothing happens without PIXEL's coordination.

Pipeline que PIXEL dirige / Pipeline PIXEL directs:
  Input Request
    → PIXEL validates & initializes
    → SectionComposer   (estructura de secciones)
    → PIXEL validates sections
    → HeartMuLaEngine   (generación de audio crudo)
    → PIXEL validates output
    → MasteringChain    (DSP: Módulos A→B→C→D)
    → PIXEL validates mastering
    → AudioAnalyzer     (métricas + reporte JSON)
    → PIXEL returns PixelResult

State machine:
  IDLE → COMPOSING → GENERATING → MASTERING → ANALYZING → DONE
                                                         ↓ (on error)
                                                       ERROR
"""

import time
import uuid
import traceback
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Optional, Dict, Any, List

from config import (
    SongParams,
    GenerationResult,
    ProcessingResult,
    MetricsReport,
    AUDIO_CONFIG,
    PIXEL_RETRY_CONFIG,
    ensure_directories,
    MAX_FRAGMENT_DURATION_SECONDS,
    SEED_OVERLAP_SECONDS,
)
from utils.audio_io import concatenate_files
from generators.section_composer import SectionComposer
from generators.heartmula_engine import HeartMuLaEngine
from generators.ace_step_engine import ACE_Step_Engine
from post_processing.mastering_chain import MasteringChain
from metrics.audio_analyzer import AudioAnalyzer
from utils.logging_utils import setup_logger, PerformanceTracker

logger = setup_logger("PIXEL")


# ===========================================================================
# Estado de la máquina de estados / State machine enum
# ===========================================================================
class PixelState(Enum):
    IDLE      = auto()
    COMPOSING = auto()
    GENERATING = auto()
    MASTERING = auto()
    ANALYZING = auto()
    DONE      = auto()
    ERROR     = auto()


# ===========================================================================
# Request / Result data classes
# ===========================================================================
@dataclass
class PixelRequest:
    """
    Solicitud de generación de audio enviada a PIXEL.
    Parámetros mínimos requeridos: genre, mood, language, duration_seconds.
    """
    genre:            str
    mood:             str
    language:         str
    duration_seconds: int
    lyrics:           Optional[str]       = None
    bpm:              Optional[int]       = None
    title:            Optional[str]       = None
    structure:        Optional[List[str]] = None
    track_id:         Optional[str]       = None
    # Opciones de pipeline / Pipeline options
    skip_mastering:   bool = False
    skip_analysis:    bool = False
    # Orquestación de Coherencia — canciones por bloques
    seed_audio_path:   Optional[str]      = None
    fragment_lyrics:   Optional[str]      = None
    fragment_index:    Optional[int]      = None
    total_fragments:   Optional[int]      = None
    is_coherent_song:  bool = False
    # Selección de motor de generación (Fase 2 - ACE-Step)
    engine:            Optional[str]      = None  # 'heartmula' o 'ace_step'


@dataclass
class PixelResult:
    """
    Resultado completo de una solicitud procesada por PIXEL.
    Incluye paths, métricas y estado final.
    """
    track_id:          str
    state:             PixelState
    raw_audio_path:    Optional[str]       = None
    mastered_audio_path: Optional[str]     = None
    metrics_report:    Optional[MetricsReport] = None
    section_plan:      Optional[List[Dict]] = None
    total_time_s:      float = 0.0
    error:             Optional[str]       = None

    @property
    def success(self) -> bool:
        return self.state == PixelState.DONE

    def to_dict(self) -> Dict[str, Any]:
        """Serializa el resultado a un diccionario JSON-friendly."""
        return {
            "track_id":            self.track_id,
            "state":               self.state.name,
            "success":             self.success,
            "raw_audio_path":      self.raw_audio_path,
            "mastered_audio_path": self.mastered_audio_path,
            "section_plan":        self.section_plan,
            "total_time_s":        round(self.total_time_s, 2),
            "error":               self.error,
            "engine_used": (
                self.metrics_report.generation_metrics.get("engine_used", "heartmula")
                if self.metrics_report else None
            ),
            "metrics": (
                {
                    "quality_score":         self.metrics_report.audio_metrics.get("quality_score"),
                    "production_ready":      self.metrics_report.audio_metrics.get("production_ready"),
                    "lufs":                  self.metrics_report.audio_metrics.get("lufs_integrated"),
                    "true_peak_db":          self.metrics_report.audio_metrics.get("true_peak_db"),
                    "spectral_centroid_hz":  self.metrics_report.audio_metrics.get("spectral_centroid_hz"),
                    "spectral_bandwidth_hz": self.metrics_report.audio_metrics.get("spectral_bandwidth_hz"),
                    "dynamic_range_db":      self.metrics_report.audio_metrics.get("dynamic_range_db"),
                }
                if self.metrics_report else None
            ),
        }


# ===========================================================================
# PIXEL — Orquestador Central
# ===========================================================================
class Pixel:
    """
    PIXEL: El cerebro del sistema SON1KVERSE Audio Engine.

    Controla el ciclo de vida completo de cada solicitud de generación.
    Implementa retry logic, state management, y validación entre etapas.

    Ejemplo de uso / Usage example:
        pixel = Pixel()
        request = PixelRequest(
            genre="latin pop",
            mood="romantic",
            language="spanish",
            duration_seconds=180,
        )
        result = pixel.process(request)
        print(result.to_dict())
    """

    def __init__(
        self,
        max_retries: int   = PIXEL_RETRY_CONFIG["max_retries"],
        retry_delay: float = PIXEL_RETRY_CONFIG["retry_delay_s"],
        keep_model_loaded: bool = True,
        ace_step_engine: Optional[ACE_Step_Engine] = None,
    ):
        """
        Inicializa PIXEL y sus herramientas.

        Args:
            max_retries:        Número máximo de reintentos por etapa
            retry_delay:        Delay en segundos entre reintentos
            keep_model_loaded:  Mantener el modelo en VRAM entre requests
            ace_step_engine:    Instancia opcional de ACE_Step_Engine para generación rápida
        """
        self._max_retries       = max_retries
        self._retry_delay       = retry_delay
        self._keep_model_loaded = keep_model_loaded

        # Herramientas / Tools (lazy-initialized)
        self._generator: Optional[HeartMuLaEngine] = None
        self._ace_step: Optional[ACE_Step_Engine]  = ace_step_engine
        self._mastering: Optional[MasteringChain]  = None
        self._analyzer:  Optional[AudioAnalyzer]   = None

        # Estado interno / Internal state
        self._state:    PixelState   = PixelState.IDLE
        self._track_id: Optional[str] = None

        ensure_directories()
        logger.info("=" * 60)
        logger.info("🎛️  PIXEL inicializado — Sistema SON1KVERSE Audio Engine")
        logger.info(f"   Max retries: {max_retries} | Retry delay: {retry_delay}s")
        logger.info(f"   Keep model loaded: {keep_model_loaded}")
        logger.info("=" * 60)

    # ------------------------------------------------------------------
    # Inicialización lazy de herramientas / Lazy tool initialization
    # ------------------------------------------------------------------
    @property
    def generator(self) -> HeartMuLaEngine:
        if self._generator is None:
            logger.info("[PIXEL] Inicializando HeartMuLaEngine...")
            self._generator = HeartMuLaEngine()
        return self._generator

    @property
    def mastering(self) -> MasteringChain:
        if self._mastering is None:
            logger.info("[PIXEL] Inicializando MasteringChain...")
            self._mastering = MasteringChain()
        return self._mastering

    @property
    def analyzer(self) -> AudioAnalyzer:
        if self._analyzer is None:
            logger.info("[PIXEL] Inicializando AudioAnalyzer...")
            self._analyzer = AudioAnalyzer(sample_rate=AUDIO_CONFIG["sample_rate"])
        return self._analyzer

    # ------------------------------------------------------------------
    # Punto de entrada principal / Main entry point
    # ------------------------------------------------------------------
    def process(self, request: PixelRequest) -> PixelResult:
        """
        Procesa una solicitud de generación completa.
        Este es el único método público para generar audio.

        Flujo:
          validate_request → compose_sections → generate_audio
          → master_audio → analyze_audio → return_result

        Args:
            request: PixelRequest con todos los parámetros

        Returns:
            PixelResult con paths, métricas y estado final
        """
        track_id         = self._resolve_track_id(request)
        self._track_id   = track_id
        start_time       = time.time()
        result           = PixelResult(track_id=track_id, state=PixelState.IDLE)

        logger.info("\n" + "=" * 60)
        logger.info(f"🎯 PIXEL recibió nueva solicitud | track_id={track_id}")
        logger.info(f"   {request.genre} / {request.mood} / {request.language}")
        logger.info(f"   Duración: {request.duration_seconds}s")
        logger.info("=" * 60)

        try:
            with PerformanceTracker(f"PIXEL Pipeline [{track_id}]") as tracker:

                # ----------------------------------------------------------
                # 0. Validar solicitud / Validate request
                # ----------------------------------------------------------
                self._validate_request(request)
                # En modo coherente por bloques, la letra del fragmento y su
                # duración (máx. 15s) reemplazan los valores globales.
                fragment_lyrics = request.fragment_lyrics or request.lyrics
                fragment_duration = (
                    min(int(request.duration_seconds), MAX_FRAGMENT_DURATION_SECONDS)
                    if request.fragment_lyrics
                    else request.duration_seconds
                )

                song_params = SongParams(
                    genre            = request.genre,
                    mood             = request.mood,
                    language         = request.language,
                    duration_seconds = fragment_duration,
                    lyrics           = fragment_lyrics,
                    bpm              = request.bpm,
                    title            = request.title or track_id,
                    structure        = request.structure,
                    engine           = request.engine,
                )

                # ----------------------------------------------------------
                # 1. SectionComposer — estructura de secciones
                # ----------------------------------------------------------
                self._transition(PixelState.COMPOSING)
                sections, section_plan = self._stage_compose(song_params)
                result.section_plan    = section_plan
                tracker.checkpoint("secciones_compuestas")
                logger.info(f"[PIXEL] ✅ Secciones: {len(sections)} | Plan listo")

                # ----------------------------------------------------------
                # 2. HeartMuLaEngine — generación de audio crudo
                #    (modo fragmento con semilla si es canción coherente)
                # ----------------------------------------------------------
                self._transition(PixelState.GENERATING)
                if request.fragment_lyrics:
                    gen_result = self._stage_generate_fragment(
                        song_params,
                        request.fragment_lyrics,
                        request.seed_audio_path,
                    )
                else:
                    gen_result = self._stage_generate(song_params, sections)
                result.raw_audio_path = gen_result.audio_path
                tracker.checkpoint("audio_generado")
                logger.info(f"[PIXEL] ✅ Audio crudo: {gen_result.audio_path}")

                # ----------------------------------------------------------
                # 3. MasteringChain — DSP post-processing
                # ----------------------------------------------------------
                mastering_result: Optional[ProcessingResult] = None

                if not request.skip_mastering:
                    self._transition(PixelState.MASTERING)
                    mastering_result = self._stage_master(Path(gen_result.audio_path))
                    result.mastered_audio_path = mastering_result.output_path
                    tracker.checkpoint("mastering_completado")
                    logger.info(f"[PIXEL] ✅ Mastered: {mastering_result.output_path}")
                else:
                    result.mastered_audio_path = gen_result.audio_path
                    logger.info("[PIXEL] ⏩ Mastering omitido (skip_mastering=True)")

                # ----------------------------------------------------------
                # 4. AudioAnalyzer — métricas y reporte JSON
                # ----------------------------------------------------------
                if not request.skip_analysis:
                    self._transition(PixelState.ANALYZING)
                    final_audio_path = result.mastered_audio_path or gen_result.audio_path
                    metrics_report   = self._stage_analyze(
                        audio_path         = Path(final_audio_path),
                        track_id           = track_id,
                        song_params        = song_params,
                        gen_result         = gen_result,
                        mastering_result   = mastering_result,
                    )
                    result.metrics_report = metrics_report
                    tracker.checkpoint("analisis_completado")
                    logger.info(
                        f"[PIXEL] ✅ Score: {metrics_report.audio_metrics.get('quality_score', 0):.1f}/100"
                    )
                else:
                    logger.info("[PIXEL] ⏩ Análisis omitido (skip_analysis=True)")

                # ----------------------------------------------------------
                # 5. Éxito / Success
                # ----------------------------------------------------------
                result.total_time_s = time.time() - start_time
                self._transition(PixelState.DONE)
                result.state        = PixelState.DONE

                logger.info("\n" + "=" * 60)
                logger.info(f"🏁 PIXEL: Pipeline completado | track_id={track_id}")
                logger.info(f"   Tiempo total: {result.total_time_s:.2f}s")
                logger.info("=" * 60)

                # Liberar VRAM si está configurado
                if not self._keep_model_loaded and self._generator:
                    self._generator.unload_model()

                return result

        except Exception as e:
            result.total_time_s = time.time() - start_time
            result.state        = PixelState.ERROR
            result.error        = f"[{self._state.name}] {str(e)}"
            self._transition(PixelState.ERROR)

            logger.error(f"❌ PIXEL: Error en stage {self._state.name} | {e}")
            logger.error(traceback.format_exc())
            return result

    # ------------------------------------------------------------------
    # Etapas con retry / Stages with retry logic
    # ------------------------------------------------------------------
    def _stage_compose(self, params: SongParams):
        """Etapa 1: SectionComposer con retry."""
        def _do():
            composer  = SectionComposer(params)
            sections  = composer.compose()
            plan      = composer.get_plan_as_dict()
            if not sections:
                raise ValueError("SectionComposer retornó lista vacía")
            return sections, plan

        return self._with_retry("SectionComposer", _do)

    def _stage_generate(self, params: SongParams, sections) -> GenerationResult:
        """Etapa 2: Generación de audio (HeartMuLa o ACE-Step) con retry."""
        def _do():
            if params.engine == 'ace_step' and self._ace_step:
                if not self._ace_step.is_loaded:
                    if not self._ace_step.load_model():
                        raise RuntimeError("No se pudo cargar ACE_Step_Engine")
                result = self._ace_step.generate_fragment(params, output_path=None)
                if not result or not Path(result.get("audio_path", "")).exists():
                    raise RuntimeError(f"Audio ACE-Step no encontrado: {result}")
                # Convertir el dict de ACE-Step a GenerationResult
                return GenerationResult(
                    audio_path=result["audio_path"],
                    duration=result.get("duration", 0.0),
                    sample_rate=result.get("sample_rate", AUDIO_CONFIG["sample_rate"]),
                    sections=sections,
                    generation_time=result.get("generation_time", 0.0),
                    vram_used_mb=0.0,
                    metadata={
                        **result.get("metadata", {}),
                        "engine_used": "ace_step",
                    },
                )
            else:
                if not self.generator.is_loaded:
                    if not self.generator.load_model():
                        raise RuntimeError("No se pudo cargar HeartMuLaEngine")
                result = self.generator.generate(params, sections)
                if not result or not Path(result.audio_path).exists():
                    raise RuntimeError(f"Audio generado no encontrado: {result.audio_path if result else 'None'}")
                return result

        return self._with_retry("HeartMuLaEngine", _do)

    def _stage_generate_fragment(
        self,
        params: SongParams,
        fragment_lyrics: str,
        seed_audio_path: Optional[str | Path] = None,
    ) -> GenerationResult:
        """Etapa 2b: Generación de fragmento (HeartMuLa o ACE-Step) con retry."""
        def _do():
            if params.engine == 'ace_step' and self._ace_step:
                if not self._ace_step.is_loaded:
                    if not self._ace_step.load_model():
                        raise RuntimeError("No se pudo cargar ACE_Step_Engine")
                # Para ACE-Step, pasamos las letras del fragmento como prompt
                params_for_ace = {
                    **{
                        k: v for k, v in {
                            "genre": params.genre,
                            "mood": params.mood,
                            "language": params.language,
                            "duration_seconds": params.duration_seconds,
                            "lyrics": fragment_lyrics,
                            "bpm": params.bpm,
                            "title": params.title,
                        }.items() if v is not None
                    },
                    "output_path": None,
                }
                result = self._ace_step.generate_fragment(params_for_ace)
                if not result or not Path(result.get("audio_path", "")).exists():
                    raise RuntimeError(f"Fragmento ACE-Step no encontrado: {result}")
                return GenerationResult(
                    audio_path=result["audio_path"],
                    duration=result.get("duration", 0.0),
                    sample_rate=result.get("sample_rate", AUDIO_CONFIG["sample_rate"]),
                    sections=[],
                    generation_time=result.get("generation_time", 0.0),
                    vram_used_mb=0.0,
                    metadata={
                        **result.get("metadata", {}),
                        "engine_used": "ace_step",
                        "fragment_lyrics": fragment_lyrics,
                        "seed_audio_path": str(seed_audio_path) if seed_audio_path else None,
                    },
                )
            else:
                if not self.generator.is_loaded:
                    if not self.generator.load_model():
                        raise RuntimeError("No se pudo cargar HeartMuLaEngine")
                result = self.generator.generate_fragment(
                    params,
                    fragment_lyrics=fragment_lyrics,
                    seed_audio_path=seed_audio_path,
                )
                if not result or not Path(result.audio_path).exists():
                    raise RuntimeError(
                        f"Fragmento de audio no encontrado: {result.audio_path if result else 'None'}"
                    )
                return result

        return self._with_retry("HeartMuLaEngine.generate_fragment", _do)

    def _stage_master(self, audio_path: Path) -> ProcessingResult:
        """Etapa 3: MasteringChain con retry."""
        def _do():
            result = self.mastering.master(audio_path)
            if not Path(result.output_path).exists():
                raise RuntimeError(f"Audio masterizado no encontrado: {result.output_path}")
            return result

        return self._with_retry("MasteringChain", _do)

    def _stage_analyze(
        self,
        audio_path:       Path,
        track_id:         str,
        song_params:      SongParams,
        gen_result:       GenerationResult,
        mastering_result: Optional[ProcessingResult],
    ) -> MetricsReport:
        """Etapa 4: AudioAnalyzer con retry."""
        def _do():
            gen_metrics = {
                "generation_time":   gen_result.generation_time,
                "vram_used_mb":      gen_result.vram_used_mb,
                "actual_duration_s": gen_result.duration,
                "sections_count":    len(gen_result.sections),
                **gen_result.metadata,
            }
            proc_metrics = mastering_result.stage_metrics if mastering_result else None

            return self.analyzer.analyze(
                audio_path         = audio_path,
                track_id           = track_id,
                song_params        = {
                    "genre":    song_params.genre,
                    "mood":     song_params.mood,
                    "language": song_params.language,
                    "bpm":      song_params.bpm,
                    "duration": song_params.duration_seconds,
                },
                generation_metrics  = gen_metrics,
                processing_metrics  = proc_metrics,
            )

        return self._with_retry("AudioAnalyzer", _do)

    # ------------------------------------------------------------------
    # Retry logic genérico / Generic retry logic
    # ------------------------------------------------------------------
    def _with_retry(self, stage_name: str, fn, *args, **kwargs):
        """
        Ejecuta `fn` con hasta `max_retries` reintentos.
        Lanza la última excepción si todos los intentos fallan.
        """
        last_exc: Optional[Exception] = None

        for attempt in range(1, self._max_retries + 1):
            try:
                logger.info(f"[PIXEL → {stage_name}] Intento {attempt}/{self._max_retries}")
                return fn(*args, **kwargs)
            except Exception as e:
                last_exc = e
                logger.warning(f"[PIXEL → {stage_name}] Fallo intento {attempt}: {e}")
                if attempt < self._max_retries:
                    logger.info(f"[PIXEL → {stage_name}] Esperando {self._retry_delay}s antes de reintentar...")
                    time.sleep(self._retry_delay)

        raise RuntimeError(
            f"Stage '{stage_name}' falló después de {self._max_retries} intentos. "
            f"Último error: {last_exc}"
        ) from last_exc

    # ------------------------------------------------------------------
    # State machine
    # ------------------------------------------------------------------
    def _transition(self, new_state: PixelState):
        old_state    = self._state
        self._state  = new_state
        logger.info(f"[PIXEL STATE] {old_state.name} → {new_state.name}")

    @property
    def state(self) -> PixelState:
        return self._state

    # ------------------------------------------------------------------
    # Validación de solicitud / Request validation
    # ------------------------------------------------------------------
    @staticmethod
    def _validate_request(request: PixelRequest):
        errors = []
        if not request.genre.strip():
            errors.append("genre no puede estar vacío")
        if not request.mood.strip():
            errors.append("mood no puede estar vacío")
        if not request.language.strip():
            errors.append("language no puede estar vacío")
        if request.duration_seconds < 10:
            errors.append("duration_seconds debe ser >= 10")
        if request.duration_seconds > 600:
            errors.append("duration_seconds debe ser <= 600")
        if errors:
            raise ValueError(f"Solicitud inválida: {'; '.join(errors)}")

    # ------------------------------------------------------------------
    # Track ID — una sola generación por petición
    # ------------------------------------------------------------------
    @staticmethod
    def new_track_id(request: PixelRequest) -> str:
        genre_slug = request.genre.lower().replace(" ", "_")[:10]
        short_uuid = uuid.uuid4().hex[:8]
        return f"{genre_slug}_{short_uuid}"

    @classmethod
    def _resolve_track_id(cls, request: PixelRequest) -> str:
        """
        Reutiliza request.track_id si ya existe (p. ej. FastAPI).
        Solo genera uno nuevo cuando PIXEL se usa de forma directa.
        """
        existing = (request.track_id or "").strip()
        if existing:
            request.track_id = existing
            return existing
        track_id = cls.new_track_id(request)
        request.track_id = track_id
        return track_id

    # ------------------------------------------------------------------
    # Gestión del modelo
    # ------------------------------------------------------------------
    def preload_model(self) -> bool:
        """Pre-carga el modelo HeartMuLa en VRAM (útil antes del primer request)."""
        logger.info("[PIXEL] Pre-cargando HeartMuLaEngine...")
        return self.generator.load_model()

    def unload_model(self):
        """Libera el modelo de VRAM explícitamente."""
        if self._generator and self._generator.is_loaded:
            self._generator.unload_model()
            logger.info("[PIXEL] Modelo descargado bajo petición explícita.")

    def health_check(self) -> Dict[str, Any]:
        """Retorna el estado de salud de PIXEL y sus dependencias."""
        import torch
        return {
            "pixel_state":       self._state.name,
            "model_loaded":      bool(self._generator and self._generator.is_loaded),
            "cuda_available":    torch.cuda.is_available(),
            "device":            str(self._generator.device if self._generator else "not initialized"),
            "vram_total_gb":     (
                torch.cuda.get_device_properties(0).total_memory / 1e9
                if torch.cuda.is_available() else 0.0
            ),
            "vram_used_mb":      (
                torch.cuda.memory_allocated() / 1e6
                if torch.cuda.is_available() else 0.0
            ),
        }

    # ------------------------------------------------------------------
    # Concatenación de fragmentos (etapa final de la canción coherente)
    # ------------------------------------------------------------------
    def concatenate_audio(
        self,
        paths: list[str | Path],
        output_name: str | None = None,
    ) -> str:
        """
        Une varios WAV de fragmentos en un único archivo final con crossfade.
        Retorna la ruta del WAV concatenado.
        """
        from config import PATHS
        ts       = int(time.time())
        uid      = uuid.uuid4().hex[:6]
        name     = output_name or f"coherent_song_{ts}_{uid}.wav"
        output   = Path(PATHS["processed_output"]) / name

        final_path = concatenate_files(paths, output)
        logger.info(f"[PIXEL] Canción coherente ensamblada: {final_path}")
        return str(final_path)
