"""Uniform error model for the Music Lab API."""

from __future__ import annotations

from typing import Any


class MusicLabError(Exception):
    """Base error with a stable machine-readable code."""

    code = "INTERNAL_ERROR"
    status_code = 500
    message = "Internal error"

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or self.message
        self.details = details or {}
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message)

    def to_payload(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


class NotSupportedError(MusicLabError):
    code = "NOT_SUPPORTED"
    status_code = 501
    message = "Operation is not supported by the selected engine"


class EngineUnavailableError(MusicLabError):
    code = "ENGINE_UNAVAILABLE"
    status_code = 503
    message = "No generation engine is available"


class JobNotFoundError(MusicLabError):
    code = "JOB_NOT_FOUND"
    status_code = 404
    message = "Job not found"


class AudioNotReadyError(MusicLabError):
    code = "AUDIO_NOT_READY"
    status_code = 409
    message = "Job audio is not available"


class UnauthorizedError(MusicLabError):
    code = "UNAUTHORIZED"
    status_code = 401
    message = "Missing or invalid x-api-key"


class InvalidRequestError(MusicLabError):
    code = "INVALID_REQUEST"
    status_code = 422
    message = "Invalid request"


class OutputFormatError(MusicLabError):
    code = "OUTPUT_FORMAT_UNSUPPORTED"
    status_code = 501
    message = "Requested output format is not available on this host"


class JobExecutionError(MusicLabError):
    code = "JOB_FAILED"
    status_code = 500
    message = "Job execution failed"
