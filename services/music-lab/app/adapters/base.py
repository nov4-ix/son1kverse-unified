"""Abstract audio generation interface implemented by every engine adapter."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from app.schemas import (
    AdapterHealth,
    CoverRequest,
    EngineName,
    GenerateRequest,
    GenerationResult,
    RepaintRequest,
    StemsRequest,
    StemsResult,
)


class AudioGeneratorInterface(ABC):
    """Every adapter exposes the same async contract.

    Unsupported operations must raise ``app.errors.NotSupportedError`` so the
    HTTP layer can map them to a stable 501 response.
    """

    engine: ClassVar[EngineName]
    supported_methods: ClassVar[frozenset[str]] = frozenset()

    @abstractmethod
    async def generate(self, req: GenerateRequest) -> GenerationResult:
        """Generate a new audio file."""

    @abstractmethod
    async def repaint(self, req: RepaintRequest) -> GenerationResult:
        """Replace an existing time range with newly generated audio."""

    @abstractmethod
    async def cover(self, req: CoverRequest) -> GenerationResult:
        """Re-synthesize an existing source with a different key/style."""

    @abstractmethod
    async def stems(self, req: StemsRequest) -> StemsResult:
        """Split a mix into drums, bass and other."""

    @abstractmethod
    async def health(self) -> AdapterHealth:
        """Report whether the adapter can run without crashing the service."""

    @abstractmethod
    async def capabilities(self) -> set[str]:
        """Return the operations this adapter can actually perform."""

    async def close(self) -> None:
        """Release loaded resources. Adapters may override this hook."""
        return None
