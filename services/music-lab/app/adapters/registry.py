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
    requested_engine: EngineName | None
    fallback_reason: str | None = None


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

    @property
    def configured_mode(self) -> str:
        return self._settings.music_lab_mode

    async def health(self, engine: EngineName) -> AdapterHealth:
        return await self._adapters[engine].health()

    async def health_snapshot(self) -> dict[EngineName, AdapterHealth]:
        return {engine: await adapter.health() for engine, adapter in self._adapters.items()}

    async def select(self, requested: EngineName | None = None) -> Selection:
        if requested is not None:
            return Selection(
                adapter=self._adapters[requested],
                mode=requested,
                requested_engine=requested,
            )

        mode = self._settings.music_lab_mode
        if mode == EngineName.SIMULATION.value:
            return Selection(
                adapter=self._adapters[EngineName.SIMULATION],
                mode=EngineName.SIMULATION,
                requested_engine=None,
            )
        if mode == EngineName.ACE_STEP.value:
            return Selection(
                adapter=self._adapters[EngineName.ACE_STEP],
                mode=EngineName.ACE_STEP,
                requested_engine=None,
            )
        if mode != "auto":
            raise EngineUnavailableError(
                "Unknown MUSIC_LAB_MODE",
                details={"mode": mode},
            )
        return await self._select_auto()

    async def _select_auto(self) -> Selection:
        checked: dict[str, str] = {}
        for engine in (EngineName.ACE_STEP,):
            health = await self._adapters[engine].health()
            if health.ready:
                return Selection(
                    adapter=self._adapters[engine],
                    mode=engine,
                    requested_engine=None,
                )
            checked[engine.value] = health.reason or "not ready"

        if self._settings.music_lab_allow_sim_fallback:
            return Selection(
                adapter=self._adapters[EngineName.SIMULATION],
                mode=EngineName.SIMULATION,
                requested_engine=None,
                fallback_reason="; ".join(f"{name}: {reason}" for name, reason in checked.items()),
            )

        raise EngineUnavailableError(
            "No GPU engine is ready in auto mode",
            details={
                "mode": "auto",
                "checked": checked,
                "allow_sim_fallback": False,
                "hint": (
                    "Install a GPU engine and mount its weights, or select "
                    "MUSIC_LAB_MODE=simulation explicitly"
                ),
            },
        )

    def modes(self) -> list[str]:
        return [mode.value for mode in EngineName] + ["auto"]

    def engines(self) -> list[EngineName]:
        return list(self._adapters)

    async def close(self) -> None:
        for adapter in self._adapters.values():
            await adapter.close()
