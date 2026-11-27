"""Adapter registry and engine selection policy."""

from __future__ import annotations

from dataclasses import dataclass

from app.adapters.ace_step import AceStepAdapter
from app.adapters.base import AudioGeneratorInterface
from app.adapters.simulation import SimulationAdapter
from app.config import Settings, get_settings
from app.errors import EngineUnavailableError
from app.schemas import AdapterHealth, EngineName


@dataclass(slots=True)
class Selection:
    adapter: AudioGeneratorInterface
    mode: EngineName


class AdapterRegistry:
    """Owns the adapter instances and resolves the active engine per request."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._adapters: dict[EngineName, AudioGeneratorInterface] = {
            EngineName.SIMULATION: SimulationAdapter(self._settings),
            EngineName.ACE_STEP: AceStepAdapter(self._settings),
        }

    def get(self, engine: EngineName) -> AudioGeneratorInterface:
        return self._adapters[engine]

    async def health(self, engine: EngineName) -> AdapterHealth:
        return await self._adapters[engine].health()

    async def health_snapshot(self) -> dict[EngineName, AdapterHealth]:
        return {engine: await adapter.health() for engine, adapter in self._adapters.items()}

    async def select(self, requested: EngineName | None = None) -> Selection:
        engine = requested or EngineName(self._settings.music_lab_mode)
        try:
            adapter = self._adapters[engine]
        except KeyError as exc:
            raise EngineUnavailableError(
                "Unknown generation engine",
                details={"engine": engine.value},
            ) from exc
        return Selection(adapter=adapter, mode=engine)

    def modes(self) -> list[str]:
        return [mode.value for mode in EngineName]

    def engines(self) -> list[EngineName]:
        return list(self._adapters)

    async def close(self) -> None:
        for adapter in self._adapters.values():
            await adapter.close()
