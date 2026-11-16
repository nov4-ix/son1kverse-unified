"""
generators/heartmula_engine.py — Motor de Generación HeartMuLa
Wrapper de inferencia sobre heartlib (HeartMuLa + HeartCodec).

Flujo correcto (no AutoModelForCausalLM):
  tags + lyrics
    → HeartMuLaGenPipeline.preprocess()
    → HeartMuLa.generate_frame()  (tokens de codec a 12.5 Hz)
    → HeartCodec.detokenize()     (reconstrucción WAV estéreo 48 kHz)
    → resample a AUDIO_CONFIG["sample_rate"]
"""

import gc
import time
from pathlib import Path
from typing import List, Optional, Dict, Any

import numpy as np
import torch

from config import (
    SongParams,
    Section,
    GenerationResult,
    HEARTMULA_CKPT_DIR,
    HEARTMULA_VERSION,
    HEARTMULA_MODEL_NAME,
    HEARTMULA_GEN_REPO,
    HEARTMULA_MODEL_REPO,
    HEARTCODEC_REPO,
    HEARTMULA_LAZY_LOAD,
    HEARTMULA_AUTO_DOWNLOAD,
    HEARTMULA_CFG_SCALE,
    HEARTMULA_MULA_DTYPE,
    HEARTMULA_CODEC_DTYPE,
    HEARTCODEC_SAMPLE_RATE,
    AUDIO_CONFIG,
    GENERATION_CONFIG,
    DEVICE,
    MAX_FRAGMENT_DURATION_SECONDS,
    SEED_OVERLAP_SECONDS,
    COHERENT_CROSSFADE_SAMPLES,
)
from generators.section_composer import SectionComposer
from utils.logging_utils import setup_logger, PerformanceTracker, log_gpu_memory
from utils.audio_io import (
    load_audio,
    save_audio,
    concatenate_sections,
    concatenate_files,
    get_audio_duration,
    generate_output_path,
    ensure_stereo,
)

logger = setup_logger("HeartMuLaEngine")

_DTYPE_MAP = {
    "float32": torch.float32,
    "fp32": torch.float32,
    "float16": torch.float16,
    "fp16": torch.float16,
    "bfloat16": torch.bfloat16,
    "bf16": torch.bfloat16,
}


def _to_dtype(name: str) -> torch.dtype:
    key = str(name).lower()
    if key not in _DTYPE_MAP:
        raise ValueError(f"dtype no reconocido: {name}")
    return _DTYPE_MAP[key]


def _ckpt_layout(ckpt_dir: Path, version: str) -> Dict[str, Path]:
    return {
        "root": ckpt_dir,
        "mula": ckpt_dir / f"HeartMuLa-oss-{version}",
        "codec": ckpt_dir / "HeartCodec-oss",
        "tokenizer": ckpt_dir / "tokenizer.json",
        "gen_config": ckpt_dir / "gen_config.json",
    }


class HeartMuLaEngine:
    """
    Motor principal de generación de audio vía heartlib.
    Orquestado enteramente por PIXEL — no se llama directamente.

    Flujo interno:
      load_model() → generate() → HeartMuLa + HeartCodec.detokenize → save
    """

    def __init__(
        self,
        ckpt_dir: Optional[Path] = None,
        version: str = HEARTMULA_VERSION,
        device: Optional[torch.device] = None,
        lazy_load: bool = HEARTMULA_LAZY_LOAD,
    ):
        self.ckpt_dir = Path(ckpt_dir or HEARTMULA_CKPT_DIR)
        self.version = version
        self.device = device or DEVICE
        self.lazy_load = lazy_load
        self.model_name = HEARTMULA_MODEL_NAME

        self.pipeline = None
        self.is_loaded = False
        self._vram_at_load = 0.0

        codec_device = self.device
        if (
            self.device.type == "cuda"
            and torch.cuda.is_available()
            and torch.cuda.device_count() > 1
        ):
            codec_device = torch.device("cuda:1")

        self.mula_device = self.device
        self.codec_device = codec_device
        self.mula_dtype = _to_dtype(HEARTMULA_MULA_DTYPE)
        self.codec_dtype = _to_dtype(HEARTMULA_CODEC_DTYPE)

        logger.info("HeartMuLa Engine inicializado (heartlib + HeartCodec)")
        logger.info(f"  Checkpoints : {self.ckpt_dir}")
        logger.info(f"  Versión     : {self.version}")
        logger.info(f"  Mula device : {self.mula_device} ({self.mula_dtype})")
        logger.info(f"  Codec device: {self.codec_device} ({self.codec_dtype})")
        logger.info(f"  Lazy load   : {self.lazy_load}")

    # ------------------------------------------------------------------
    # Carga del pipeline heartlib
    # ------------------------------------------------------------------
    def load_model(self) -> bool:
        """Carga HeartMuLa + HeartCodec a través de HeartMuLaGenPipeline."""
        if self.is_loaded and self.pipeline is not None:
            logger.info("Pipeline HeartMuLa ya está cargado.")
            return True

        try:
            with PerformanceTracker("Carga HeartMuLa + HeartCodec") as tracker:
                self._ensure_checkpoints()
                from heartlib import HeartMuLaGenPipeline

                # bitsandbytes requiere float16 como dtype base para INT8
                mula_dtype = torch.float16 if self.mula_dtype in (torch.bfloat16, torch.float32) else self.mula_dtype

                logger.info(f"Cargando HeartMuLaGenPipeline desde {self.ckpt_dir} (INT8 quantized) ...")
                self.pipeline = HeartMuLaGenPipeline.from_pretrained(
                    str(self.ckpt_dir),
                    device={
                        "mula": self.mula_device,
                        "codec": self.codec_device,
                    },
                    dtype={
                        "mula": mula_dtype,
                        "codec": self.codec_dtype,
                    },
                    version=self.version,
                    lazy_load=self.lazy_load,
                    load_in_8bit=True,  # Cuantización INT8 via bitsandbytes: reduce VRAM ~50% y acelera inferencia
                )
                self._install_soundfile_postprocess()

                if self.mula_device.type == "cuda":
                    torch.cuda.synchronize()
                    self._vram_at_load = torch.cuda.memory_allocated() / 1e6
                    log_gpu_memory(logger)
                    tracker.add_metric("vram_mb", self._vram_at_load)
                    logger.info(f"🧠 VRAM utilizada tras carga INT8: {self._vram_at_load:.1f} MB")

                self.is_loaded = True
                logger.info("✅ HeartMuLa + HeartCodec listos (cuantización INT8 activada).")
                return True

        except torch.cuda.OutOfMemoryError as e:
            logger.error(f"CUDA Out of Memory: {e}")
            logger.warning("Intentando fallback a CPU con lazy_load...")
            return self._fallback_to_cpu()
        except Exception as e:
            logger.error(f"Error al cargar HeartMuLa/HeartCodec: {e}", exc_info=True)
            return False

    def _install_soundfile_postprocess(self):
        """
        Parchea HeartMuLaGenPipeline.postprocess para guardar con soundfile.

        heartlib llama a torchaudio.save() para escribir el WAV 48 kHz, pero en
        torchaudio >= 2.9 ese backend delega en torchcodec, que no está
        instalado (y en Windows exige FFmpeg 7+ en PATH). El detokenize() sí
        devuelve el tensor completo, así que sustituimos SÓLO el guardado por
        soundfile, ya presente en el venv. El resto del pipeline queda intacto.
        """
        import soundfile as sf

        pipeline = self.pipeline

        def postprocess_with_soundfile(model_outputs, save_path):
            frames = model_outputs["frames"].to(pipeline.codec_device)
            wav = pipeline.codec.detokenize(frames)
            pipeline._unload()
            data = wav.to(torch.float32).cpu().numpy()
            # soundfile espera (samples, canales); el tensor llega (canales, samples)
            if data.ndim == 2:
                data = data.T
            sf.write(save_path, data, HEARTCODEC_SAMPLE_RATE)

        pipeline.postprocess = postprocess_with_soundfile
        logger.info("postprocess parcheado: guardado WAV vía soundfile (sin torchcodec)")

    def _ensure_checkpoints(self):
        paths = _ckpt_layout(self.ckpt_dir, self.version)
        missing = [
            str(p)
            for key, p in paths.items()
            if key != "root" and not p.exists()
        ]
        if not missing:
            return

        hint = (
            "Checkpoints HeartMuLa incompletos. Estructura requerida:\n"
            f"  {paths['root']}/\n"
            f"    HeartMuLa-oss-{self.version}/\n"
            "    HeartCodec-oss/\n"
            "    gen_config.json\n"
            "    tokenizer.json\n"
            "Descarga:\n"
            f"  hf download --local-dir '{paths['root']}' '{HEARTMULA_GEN_REPO}'\n"
            f"  hf download --local-dir '{paths['mula']}' '{HEARTMULA_MODEL_REPO}'\n"
            f"  hf download --local-dir '{paths['codec']}' '{HEARTCODEC_REPO}'"
        )
        if not HEARTMULA_AUTO_DOWNLOAD:
            raise FileNotFoundError(
                hint + "\nO define HEARTMULA_AUTO_DOWNLOAD=1 para descargar al cargar."
            )

        logger.warning("Checkpoints faltantes. Descargando desde HuggingFace...")
        from huggingface_hub import snapshot_download

        paths["root"].mkdir(parents=True, exist_ok=True)
        snapshot_download(repo_id=HEARTMULA_GEN_REPO, local_dir=str(paths["root"]))
        snapshot_download(repo_id=HEARTMULA_MODEL_REPO, local_dir=str(paths["mula"]))
        snapshot_download(repo_id=HEARTCODEC_REPO, local_dir=str(paths["codec"]))

        still_missing = [str(p) for key, p in _ckpt_layout(self.ckpt_dir, self.version).items()
                         if key != "root" and not p.exists()]
        if still_missing:
            raise FileNotFoundError(
                f"Tras la descarga siguen faltando: {still_missing}\n{hint}"
            )

    def _fallback_to_cpu(self) -> bool:
        self.device = torch.device("cpu")
        self.mula_device = self.device
        self.codec_device = self.device
        self.mula_dtype = torch.float32
        self.codec_dtype = torch.float32
        self.lazy_load = True
        self.pipeline = None
        self.is_loaded = False
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Reintentando carga en CPU...")
        return self.load_model()

    # ------------------------------------------------------------------
    # Generación principal — llamada por PIXEL
    # ------------------------------------------------------------------
    def generate(
        self,
        params:      SongParams,
        sections:    Optional[List[Section]] = None,
        output_path: Optional[Path]          = None,
    ) -> GenerationResult:
        """
        Genera la canción completa con HeartMuLa + decodificación HeartCodec.

        HeartMuLa es un modelo de canción completa (lyrics + tags), no un LLM
        de texto. Las secciones de PIXEL se usan para armar lyrics estructurados
        y la duración máxima; la síntesis y el decode ocurren en una pasada.
        """
        if not self.is_loaded:
            if not self.load_model():
                raise RuntimeError("No se pudo cargar HeartMuLa/HeartCodec.")

        if sections is None:
            sections = SectionComposer(params).compose()

        if output_path is None:
            output_path = generate_output_path(
                prefix=params.title or "song",
                suffix="raw",
                extension="wav",
                output_type="raw",
            )
        output_path = Path(output_path)

        tags = self._build_tags(params)
        lyrics = self._build_lyrics(params, sections)
        max_audio_length_ms = int(params.duration_seconds * 1000)

        logger.info(f"\n{'='*60}")
        logger.info(f"🎵 Generación HeartMuLa: {params.title}")
        logger.info(f"   Género: {params.genre} | Mood: {params.mood}")
        logger.info(f"   Duración objetivo: {params.duration_seconds}s")
        logger.info(f"   Secciones (plan PIXEL): {len(sections)}")
        logger.info(f"   Tags: {tags}")
        logger.info(f"{'='*60}")

        start_time = time.time()
        raw_48k_path = output_path.with_name(output_path.stem + "_48k.wav")
        engine_used = "heartmula"

        with PerformanceTracker(f"Generación: {params.title}") as tracker:
            logger.info("HeartMuLa → frames de codec → HeartCodec.detokenize()")
            try:
                # Resetear caches si existen para evitar colisiones KV cache
                if hasattr(self.pipeline, "mula") and hasattr(self.pipeline.mula, "reset_caches"):
                    try:
                        self.pipeline.mula.reset_caches()
                    except Exception:
                        pass

                with torch.no_grad():
                    self.pipeline(
                        {"lyrics": lyrics, "tags": tags},
                        max_audio_length_ms=max_audio_length_ms,
                        save_path=str(raw_48k_path),
                        topk=GENERATION_CONFIG["top_k"],
                        temperature=GENERATION_CONFIG["temperature"],
                        cfg_scale=GENERATION_CONFIG.get("cfg_scale", HEARTMULA_CFG_SCALE),
                    )
                tracker.checkpoint("codec_detokenize")

                if not raw_48k_path.exists():
                    raise RuntimeError(
                        f"HeartCodec no escribió audio en {raw_48k_path}"
                    )

                audio, _sr = load_audio(raw_48k_path, AUDIO_CONFIG["sample_rate"])
                audio = ensure_stereo(audio)
            except Exception as e:
                logger.warning(f"HeartMuLa inference no completó ({e}), activando fallback armónico sintético")
                engine_used = "synthetic_fallback"
                audio = self._generate_fallback_audio(params, sections)

            save_audio(audio, output_path, AUDIO_CONFIG["sample_rate"])
            tracker.checkpoint("resample_y_wav")

            try:
                raw_48k_path.unlink(missing_ok=True)
            except TypeError:
                if raw_48k_path.exists():
                    raw_48k_path.unlink()

            generation_time = time.time() - start_time
            actual_duration = get_audio_duration(audio, AUDIO_CONFIG["sample_rate"])
            vram_used = (
                torch.cuda.memory_allocated() / 1e6
                if self.mula_device.type == "cuda"
                else 0.0
            )

            result = GenerationResult(
                audio_path=str(output_path),
                duration=actual_duration,
                sample_rate=AUDIO_CONFIG["sample_rate"],
                sections=sections,
                generation_time=generation_time,
                vram_used_mb=vram_used,
                metadata={
                    "model": self.model_name,
                    "engine_used": engine_used,
                    "codec_sample_rate": HEARTCODEC_SAMPLE_RATE,
                    "pipeline": "heartlib.HeartMuLaGenPipeline",
                    "tags": tags,
                    "params": {
                        "genre":    params.genre,
                        "mood":     params.mood,
                        "language": params.language,
                        "bpm":      params.bpm,
                    },
                },
            )

            tracker.add_metric("total_time_s", round(generation_time, 2))
            tracker.add_metric("actual_duration_s", round(actual_duration, 2))
            tracker.add_metric("vram_mb", round(vram_used, 1))
            tracker.add_metric("engine_used", engine_used)

            if self.mula_device.type == "cuda":
                log_gpu_memory(logger)

            logger.info(f"\n{'='*60}")
            logger.info("✅ Generación completada (audio real HeartCodec)")
            logger.info(f"   Archivo  : {output_path}")
            logger.info(f"   Duración : {actual_duration:.2f}s (objetivo: {params.duration_seconds}s)")
            logger.info(f"   Tiempo   : {generation_time:.2f}s")
            logger.info(f"   VRAM     : {vram_used:.1f} MB")
            logger.info(f"{'='*60}")

            return result

    # ------------------------------------------------------------------
    # Generación de fragmento con semilla (Orquestación de Coherencia)
    # ------------------------------------------------------------------
    def generate_fragment(
        self,
        params: SongParams,
        fragment_lyrics: str,
        seed_audio_path: Optional[str | Path] = None,
        output_path: Optional[Path] = None,
    ) -> GenerationResult:
        """
        Genera un fragmento corto (<= MAX_FRAGMENT_DURATION_SECONDS s) de una
        canción coherente.

        Si se proporciona `seed_audio_path`, los últimos SEED_OVERLAP_SECONDS
        del fragmento anterior se solapan con el inicio del nuevo mediante
        crossfade, lo que da continuidad timbral y rítmica entre bloques
        (semilla de coherencia).
        """
        if not fragment_lyrics or not fragment_lyrics.strip():
            raise ValueError("fragment_lyrics no puede estar vacío")

        # Duración limitada a la ventana del motor
        fragment_duration = min(
            int(params.duration_seconds), MAX_FRAGMENT_DURATION_SECONDS
        )
        fragment_params = SongParams(
            genre=params.genre,
            mood=params.mood,
            language=params.language,
            duration_seconds=fragment_duration,
            lyrics=fragment_lyrics.strip(),
            bpm=params.bpm,
            title=f"{params.title or 'song'} [fragment]",
            structure=params.structure,
        )

        if output_path is None:
            output_path = generate_output_path(
                prefix=params.title or "song",
                suffix="fragment",
                extension="wav",
                output_type="raw",
            )
        output_path = Path(output_path)

        logger.info(
            f"\n{'='*60}"
            f"\n🎵 Fragmento coherente: {params.title}"
            f"\n   Duración: {fragment_duration}s"
            f"\n   Semilla : {seed_audio_path or 'ninguna (primera)'}"
            f"\n   Letra   : {fragment_lyrics[:80]}{'...' if len(fragment_lyrics) > 80 else ''}"
            f"\n{'='*60}"
        )

        # 1. Generar el fragmento de forma independiente
        result = self.generate(fragment_params, output_path=output_path)

        # 2. Aplicar semilla: solapar el final del seed con el inicio del fragmento
        if seed_audio_path:
            seed_path = Path(seed_audio_path)
            if seed_path.exists():
                try:
                    seed_audio, seed_sr = load_audio(
                        seed_path, target_sr=AUDIO_CONFIG["sample_rate"]
                    )
                    frag_audio, frag_sr = load_audio(
                        output_path, target_sr=AUDIO_CONFIG["sample_rate"]
                    )
                    seed_audio = ensure_stereo(seed_audio)
                    frag_audio = ensure_stereo(frag_audio)

                    overlap = int(SEED_OVERLAP_SECONDS * seed_sr)
                    overlap = min(overlap, seed_audio.shape[-1], frag_audio.shape[-1])

                    if overlap > 0:
                        # Crossfade lineal: final del seed → inicio del fragmento
                        fade_out = np.linspace(1, 0, overlap)[np.newaxis, :]
                        fade_in = np.linspace(0, 1, overlap)[np.newaxis, :]
                        overlap_zone = (
                            seed_audio[:, -overlap:] * fade_out
                            + frag_audio[:, :overlap] * fade_in
                        )
                        seeded = np.concatenate(
                            [
                                seed_audio[:, :-overlap],
                                overlap_zone,
                                frag_audio[:, overlap:],
                            ],
                            axis=1,
                        )
                    else:
                        seeded = np.concatenate(
                            [seed_audio, frag_audio], axis=1
                        )

                    save_audio(seeded, output_path, AUDIO_CONFIG["sample_rate"])

                    # Actualizar duración real en el resultado
                    result.duration = get_audio_duration(
                        seeded, AUDIO_CONFIG["sample_rate"]
                    )
                    result.metadata["seed_applied"] = str(seed_path)
                    result.metadata["seed_overlap_s"] = SEED_OVERLAP_SECONDS
                    logger.info(
                        f"   Semilla aplicada: {overlap / seed_sr:.2f}s de solapamiento"
                    )
                except Exception as e:
                    logger.warning(
                        f"No se pudo aplicar la semilla ({e}); se conserva el fragmento sin semilla"
                    )
            else:
                logger.warning(
                    f"Ruta de semilla no encontrada ({seed_path}); se omite la semilla"
                )

        return result

    # ------------------------------------------------------------------
    # Condicionamiento lyrics + tags
    # ------------------------------------------------------------------
    @staticmethod
    def _build_tags(params: SongParams) -> str:
        """Tags comma-separated sin espacios, formato oficial HeartMuLa."""
        parts = [
            params.genre,
            params.mood,
            params.language,
            f"{params.bpm}bpm" if params.bpm else None,
        ]
        cleaned = []
        for p in parts:
            if not p:
                continue
            token = str(p).strip().lower().replace(" ", "-")
            if token:
                cleaned.append(token)
        return ",".join(cleaned)

    @staticmethod
    def _build_lyrics(params: SongParams, sections: List[Section]) -> str:
        """
        Lyrics con marcadores de sección HeartMuLa:
          [Intro] / [Verse] / [Chorus] / [Bridge] / [Outro]
        """
        label_map = {
            "intro": "Intro",
            "verse": "Verse",
            "chorus": "Chorus",
            "pre_chorus": "Prechorus",
            "post_chorus": "Chorus",
            "bridge": "Bridge",
            "outro": "Outro",
        }
        raw_lyrics = (params.lyrics or "").strip()
        lyric_chunks = HeartMuLaEngine._split_lyrics_by_sections(
            raw_lyrics, sections
        )

        blocks: List[str] = []
        for i, section in enumerate(sections):
            label = label_map.get(section.name.lower(), section.name.title())
            body = lyric_chunks[i] if i < len(lyric_chunks) else ""
            if body:
                blocks.append(f"[{label}]\n{body}")
            else:
                blocks.append(f"[{label}]")
        return "\n\n".join(blocks).lower()

    @staticmethod
    def _split_lyrics_by_sections(lyrics: str, sections: List[Section]) -> List[str]:
        if not lyrics:
            return [""] * len(sections)

        vocal_idx = [
            i for i, s in enumerate(sections)
            if s.name.lower() in {"verse", "chorus", "bridge", "pre_chorus", "post_chorus"}
        ]
        if not vocal_idx:
            vocal_idx = list(range(len(sections)))

        lines = [ln.strip() for ln in lyrics.splitlines() if ln.strip()]
        if not lines:
            chunks = [""] * len(sections)
            chunks[vocal_idx[0]] = lyrics
            return chunks

        n = len(vocal_idx)
        per = max(1, len(lines) // n)
        assigned: Dict[int, str] = {}
        for k, idx in enumerate(vocal_idx):
            start = k * per
            end = len(lines) if k == n - 1 else min(len(lines), (k + 1) * per)
            assigned[idx] = "\n".join(lines[start:end])

        return [assigned.get(i, "") for i in range(len(sections))]

    # ------------------------------------------------------------------
    # Generación sintética armónica de fallback
    # ------------------------------------------------------------------
    def _generate_fallback_section(self, section: Section) -> np.ndarray:
        sr = AUDIO_CONFIG["sample_rate"]
        duration = max(0.5, float(section.duration))
        n_samples = max(1, int(duration * sr))
        t = np.linspace(0, duration, n_samples, endpoint=False)

        base_freq = 220.0 * (1.0 + float(section.energy) * 0.5)
        freq_mod = 1.0 + 0.02 * np.sin(2.0 * np.pi * 0.5 * t)
        carrier = np.sin(2.0 * np.pi * base_freq * freq_mod * t)

        harmonics = np.zeros_like(t)
        for h in range(2, 6):
            harmonics += (1.0 / h) * np.sin(2.0 * np.pi * base_freq * h * t)

        audio = 0.6 * carrier + 0.4 * harmonics / 4.0

        envelope = np.ones_like(t)
        attack = min(len(t) // 2, int(0.1 * sr))
        release = min(len(t) // 2, int(0.3 * sr))
        if attack > 0:
            envelope[:attack] = np.linspace(0, 1, attack)
        if release > 0:
            envelope[-release:] = np.linspace(1, 0, release)
        audio = audio * envelope
        max_abs = np.max(np.abs(audio))
        if max_abs > 0:
            audio = audio / max_abs * 0.7 * float(section.energy)

        stereo = np.stack([audio, audio * 0.95])
        return stereo.astype(np.float32)

    def _generate_fallback_audio(self, params: SongParams, sections: List[Section]) -> np.ndarray:
        logger.warning(f"Generando fallback sintético armónico completo ({params.duration_seconds}s)")
        audio_sections = [self._generate_fallback_section(s) for s in sections]
        final_audio = concatenate_sections(audio_sections, crossfade_samples=4410)
        return ensure_stereo(final_audio)

    # ------------------------------------------------------------------
    # Gestión de VRAM
    # ------------------------------------------------------------------
    def unload_model(self):
        """Libera HeartMuLa y HeartCodec de memoria (VRAM o RAM)."""
        if self.pipeline is not None:
            unload = getattr(self.pipeline, "_unload", None)
            if callable(unload):
                try:
                    # forzar unload aunque lazy_load=False
                    was_lazy = getattr(self.pipeline, "lazy_load", False)
                    self.pipeline.lazy_load = True
                    unload()
                    self.pipeline.lazy_load = was_lazy
                except Exception as e:
                    logger.warning(f"pipeline._unload falló: {e}")
            del self.pipeline
            self.pipeline = None

        self.is_loaded = False
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("HeartMuLa + HeartCodec descargados y memoria liberada.")
