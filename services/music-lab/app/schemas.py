"""Pydantic contracts shared by adapters, jobs and the HTTP API."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EngineName(StrEnum):
    SIMULATION = "simulation"
    ACE_STEP = "ace-step"


class OutputFormat(StrEnum):
    WAV = "wav"
    MP3 = "mp3"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


StemName = Literal["drums", "bass", "other"]
OperationName = Literal["generate", "repaint", "cover", "stems"]


class GenerationParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    lyrics: str | None = Field(default=None, max_length=20_000)
    duration_s: float = Field(default=30.0, gt=0, le=600)
    seed: int = Field(default=0, ge=0, le=2**32 - 1)
    bpm: int = Field(default=120, ge=30, le=300)
    key: str = Field(default="C", min_length=1, max_length=16)
    style_tags: list[str] = Field(default_factory=list, max_length=32)
    reference_audio_path: str | None = None
    output_format: OutputFormat = OutputFormat.WAV
    master: bool = False
    engine: EngineName | None = None
    quality_preset: str | None = Field(default=None, max_length=32)


class GenerateRequest(GenerationParams):
    pass


class RepaintRequest(GenerationParams):
    source_audio_path: str
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> RepaintRequest:
        if self.end_s <= self.start_s:
            raise ValueError("end_s must be greater than start_s")
        return self


class CoverRequest(GenerationParams):
    source_audio_path: str


class StemsRequest(GenerationParams):
    source_audio_path: str | None = None


class AdapterHealth(BaseModel):
    engine: EngineName
    ready: bool
    reason: str | None = None
    device: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class GenerationResult(BaseModel):
    job_id: str
    audio_path: str
    duration_s: float
    sample_rate: int
    engine: EngineName
    mode: EngineName
    output_format: OutputFormat = OutputFormat.WAV
    metadata: dict[str, Any] = Field(default_factory=dict)


class StemsResult(BaseModel):
    job_id: str
    stems: dict[StemName, str]
    duration_s: float
    sample_rate: int
    engine: EngineName
    mode: EngineName
    metadata: dict[str, Any] = Field(default_factory=dict)


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class Job(BaseModel):
    job_id: str
    operation: OperationName
    status: JobStatus
    engine: EngineName | None = None
    mode: EngineName | None = None
    result: GenerationResult | StemsResult | None = None
    error: ErrorBody | None = None
    created_at: datetime
    updated_at: datetime


class JobAccepted(BaseModel):
    job_id: str
    status: JobStatus
    status_url: str


class Capabilities(BaseModel):
    service: str
    default_mode: str
    active_engine: EngineName | None = None
    modes: list[str]
    engines: list[EngineName]
    methods: list[str]
    output_formats: list[OutputFormat]
    max_concurrency: int


class ServiceHealth(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    mode: str
    engine: AdapterHealth | None = None
    reason: str | None = None
