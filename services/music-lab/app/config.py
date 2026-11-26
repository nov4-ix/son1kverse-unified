"""Runtime configuration for the Music Lab service."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ServiceMode = Literal["simulation", "ace-step", "auto"]


@dataclass(frozen=True, slots=True)
class QualityPreset:
    """Declarative ACE-Step quality preset.

    ``config_path`` and ``use_lm`` are deployment-level choices: they must
    match the loaded engine. ``inference_steps`` and ``guidance_scale`` are
    applied per request. ``min_vram_gb`` rejects the request before it is
    queued when the GPU is too small.
    """

    name: str
    config_path: str
    inference_steps: int
    guidance_scale: float
    use_lm: bool = False
    min_vram_gb: float = 0.0


QUALITY_PRESETS: dict[str, QualityPreset] = {
    "turbo": QualityPreset(
        name="turbo",
        config_path="acestep-v15-turbo",
        inference_steps=8,
        guidance_scale=7.0,
    ),
    "turbo_lm": QualityPreset(
        name="turbo_lm",
        config_path="acestep-v15-turbo",
        inference_steps=8,
        guidance_scale=7.0,
        use_lm=True,
    ),
    "xl_turbo": QualityPreset(
        name="xl_turbo",
        config_path="acestep-v15-xl-turbo",
        inference_steps=8,
        guidance_scale=7.0,
        min_vram_gb=20.0,
    ),
    "sft": QualityPreset(
        name="sft",
        config_path="acestep-v15-sft",
        inference_steps=50,
        guidance_scale=8.0,
    ),
}

DEFAULT_QUALITY_PRESET = "turbo"


def get_quality_preset(name: str) -> QualityPreset:
    try:
        return QUALITY_PRESETS[name]
    except KeyError:
        raise KeyError(f"Unknown quality preset: {name}") from None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    service_name: str = "son1kverse-music-lab"
    service_version: str = "0.1.0"
    host: str = "0.0.0.0"
    port: int = 8002

    music_lab_mode: ServiceMode = "simulation"
    music_lab_api_key: str | None = None
    music_lab_output_dir: Path = Path("outputs")
    music_lab_max_concurrency: int = Field(default=1, ge=1, le=8)
    music_lab_allow_sim_fallback: bool = False
    # Retención de jobs en memoria. Al expirar se elimina el job y, si está
    # dentro de MUSIC_LAB_OUTPUT_DIR, su audio. 0 desactiva el TTL.
    music_lab_job_ttl_hours: float = Field(default=24.0, ge=0)
    music_lab_max_jobs: int = Field(default=500, ge=1)
    music_lab_job_cleanup_interval_s: float = Field(default=60.0, gt=0)
    music_lab_sample_rate: int = Field(default=44100, ge=8000, le=192000)

    sim_latency_ms: int = Field(default=0, ge=0, le=60_000)

    ace_step_model_path: Path = Path("/models/ace-step")
    ace_step_device: str = "cuda"
    ace_step_dtype: Literal["bfloat16", "float16", "float32"] = "bfloat16"
    ace_step_quantization: str | None = None
    ace_step_offload: bool = False
    ace_step_python_module: str = "acestep"
    ace_step_config_path: str = "acestep-v15-turbo"
    ace_step_auto_download: bool = True
    ace_step_download_source: str | None = None
    ace_step_use_lm: bool = False
    ace_step_lm_model: str = "acestep-5Hz-lm-1.7B"
    ace_step_lm_backend: str = "pt"
    ace_step_inference_steps: int = Field(default=8, ge=1, le=200)
    ace_step_guidance_scale: float = Field(default=7.0, ge=1.0, le=15.0)
    ace_step_shift: float = Field(default=3.0, gt=0, le=5)
    ace_step_vocal_language: str = "unknown"

    @field_validator("ace_step_dtype", mode="before")
    @classmethod
    def _normalize_ace_step_dtype(cls, value: object) -> str:
        text = str(value).strip().lower()
        if text not in {"bfloat16", "float16", "float32"}:
            raise ValueError("ACE_STEP_DTYPE must be bfloat16, float16 or float32")
        return text

    @field_validator("ace_step_quantization", mode="before")
    @classmethod
    def _blank_quantization_to_none(cls, value: object) -> object:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def ensure_output_dir(self) -> Path:
        self.music_lab_output_dir.mkdir(parents=True, exist_ok=True)
        return self.music_lab_output_dir


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
