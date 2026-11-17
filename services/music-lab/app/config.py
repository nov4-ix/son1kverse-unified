"""Runtime configuration for the Music Lab service."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ServiceMode = Literal["simulation", "ace-step", "heartmula", "auto"]


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
    music_lab_sample_rate: int = Field(default=44100, ge=8000, le=192000)

    sim_latency_ms: int = Field(default=0, ge=0, le=60_000)

    ace_step_model_path: Path = Path("/models/ace-step")
    ace_step_device: str = "cuda"
    ace_step_dtype: str = "bfloat16"
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

    heartmula_ckpt_dir: Path = Path("/models/heartmula")
    heartmula_version: str = "3B"
    heartmula_device: str = "cuda"
    heartmula_dtype: str = "bfloat16"
    heartmula_lazy_load: bool = True
    heartmula_python_module: str = "heartlib"
    heartmula_temperature: float = 1.0
    heartmula_topk: int = 50
    heartmula_cfg_scale: float = 1.5

    def ensure_output_dir(self) -> Path:
        self.music_lab_output_dir.mkdir(parents=True, exist_ok=True)
        return self.music_lab_output_dir


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
