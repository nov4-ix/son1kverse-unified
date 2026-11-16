"""
generators/section_composer.py — Compositor de Secciones
Convierte SongParams de alto nivel en secciones estructuradas.
Converts high-level SongParams into structured Section objects.

Ported & enhanced from Son1k-Heart-main/generators/section_composer.py
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import random

from config import (
    SongParams,
    Section,
    SECTION_TEMPLATES,
    DEFAULT_SONG_STRUCTURE,
    AUDIO_CONFIG,
)
from utils.logging_utils import setup_logger

logger = setup_logger("SectionComposer")

# ---------------------------------------------------------------------------
# Tablas de modificadores de energía por género y mood
# Energy modifier tables per genre and mood
# ---------------------------------------------------------------------------
GENRE_ENERGY_MODIFIERS: Dict[str, float] = {
    "electronic": 0.15,
    "edm":        0.15,
    "rock":       0.10,
    "metal":      0.20,
    "jazz":      -0.10,
    "classical": -0.15,
    "ambient":   -0.20,
    "hip hop":    0.05,
    "rap":        0.05,
    "latin":      0.10,
    "pop":        0.05,
    "reggae":    -0.05,
    "blues":     -0.05,
    "folk":      -0.10,
    "r&b":        0.0,
}

MOOD_ENERGY_MODIFIERS: Dict[str, float] = {
    "energetic":   0.20,
    "upbeat":      0.15,
    "happy":       0.10,
    "romantic":    0.00,
    "melancholic": -0.15,
    "sad":         -0.20,
    "calm":        -0.10,
    "aggressive":   0.25,
    "peaceful":    -0.10,
    "dark":         0.00,
    "dreamy":      -0.05,
    "epic":         0.15,
}

SECTION_PROMPT_HINTS: Dict[str, str] = {
    "intro":       "atmospheric opening, building tension",
    "verse":       "rhythmic groove, melodic development",
    "chorus":      "energetic hook, full arrangement, memorable melody",
    "bridge":      "contrast section, breakdown or buildup",
    "outro":       "resolution, fading out, final statement",
    "pre_chorus":  "building energy, transitional, anticipation",
    "post_chorus": "celebratory, high energy, catchy",
}


class SectionComposer:
    """
    Crea el mapa estructural de una canción.
    Llamado por PIXEL antes de invocar al HeartMuLaEngine.
    """

    def __init__(self, params: SongParams):
        self.params   = params
        self.sections: List[Section] = []

    # ------------------------------------------------------------------
    # Método principal
    # ------------------------------------------------------------------
    def compose(self) -> List[Section]:
        """
        Construye y retorna la lista de secciones con duración,
        nivel de energía y prompt suffix calculados.
        """
        logger.info(f"Componiendo secciones | Género: {self.params.genre} | Mood: {self.params.mood}")

        total_duration = self.params.duration_seconds
        structure      = self.params.structure or DEFAULT_SONG_STRUCTURE
        durations      = self._calculate_section_durations(structure, total_duration)

        self.sections = []
        current_time  = 0.0

        for i, section_name in enumerate(structure):
            duration      = durations[i]
            energy        = self._calculate_section_energy(section_name)
            prompt_suffix = self._generate_prompt_suffix(section_name)

            section = Section(
                name=section_name,
                start_time=current_time,
                duration=duration,
                energy=energy,
                prompt_suffix=prompt_suffix,
            )
            self.sections.append(section)
            logger.info(
                f"  Sección {i+1}/{len(structure)}: {section_name.upper()} | "
                f"dur={duration:.1f}s | t={current_time:.1f}s | energy={energy:.2f}"
            )
            current_time += duration

        self._validate_total_duration(total_duration)
        return self.sections

    # ------------------------------------------------------------------
    # Cálculo de duraciones
    # ------------------------------------------------------------------
    def _calculate_section_durations(
        self, structure: List[str], total_duration: float
    ) -> List[float]:
        weights = [
            SECTION_TEMPLATES.get(s, SECTION_TEMPLATES["verse"])["typical_duration_ratio"]
            for s in structure
        ]
        total_weight = sum(weights)
        durations    = []

        for i, (weight, name) in enumerate(zip(weights, structure)):
            duration = (weight / total_weight) * total_duration
            # Caps para secciones no melódicas / caps for non-melodic sections
            if name == "intro":
                duration = min(duration, 20.0)
            elif name == "outro":
                duration = min(duration, 15.0)
            durations.append(duration)

        # Redistribuir el déficit en los coros / Distribute deficit into choruses
        current_total = sum(durations)
        if abs(current_total - total_duration) > 0.1:
            diff           = total_duration - current_total
            chorus_indices = [i for i, s in enumerate(structure) if s == "chorus"]
            if chorus_indices:
                per_chorus = diff / len(chorus_indices)
                for idx in chorus_indices:
                    durations[idx] += per_chorus

        return durations

    # ------------------------------------------------------------------
    # Cálculo de energía por sección
    # ------------------------------------------------------------------
    def _calculate_section_energy(self, section_name: str) -> float:
        template    = SECTION_TEMPLATES.get(section_name, SECTION_TEMPLATES["verse"])
        base_energy = template["energy"]

        genre_mod = next(
            (mod for key, mod in GENRE_ENERGY_MODIFIERS.items()
             if key in self.params.genre.lower()),
            0.0,
        )
        mood_mod = next(
            (mod for key, mod in MOOD_ENERGY_MODIFIERS.items()
             if key in self.params.mood.lower()),
            0.0,
        )

        return max(0.1, min(1.0, base_energy + genre_mod + mood_mod))

    # ------------------------------------------------------------------
    # Generación de prompt suffix
    # ------------------------------------------------------------------
    def _generate_prompt_suffix(self, section_name: str) -> str:
        hints = SECTION_PROMPT_HINTS.get(section_name, "")
        section_specific: Dict[str, str] = {
            "intro":       f"Begin with {hints}, {self.params.mood} atmosphere",
            "verse":       f"{hints}, {self.params.genre} style, {self.params.language} feel",
            "chorus":      f"{hints}, {self.params.mood} and powerful, memorable hook",
            "bridge":      f"{hints}, different texture, {self.params.genre} breakdown",
            "outro":       f"{hints}, {self.params.mood} conclusion",
            "pre_chorus":  f"{hints}, rising energy",
            "post_chorus": f"{hints}, celebration",
        }
        return section_specific.get(section_name, hints)

    # ------------------------------------------------------------------
    # Validación
    # ------------------------------------------------------------------
    def _validate_total_duration(self, target: float):
        actual = sum(s.duration for s in self.sections)
        if abs(actual - target) > 1.0:
            logger.warning(
                f"⚠️  Diferencia de duración: target={target}s | actual={actual:.1f}s"
            )

    # ------------------------------------------------------------------
    # Serialización / export
    # ------------------------------------------------------------------
    def get_plan_as_dict(self) -> List[Dict[str, Any]]:
        """Retorna el plan de secciones como lista de diccionarios (para PIXEL)."""
        return [
            {
                "section":     s.name,
                "duration":    round(s.duration, 1),
                "energy":      round(s.energy, 2),
                "start_time":  round(s.start_time, 1),
                "prompt_hint": s.prompt_suffix,
            }
            for s in self.sections
        ]


# ---------------------------------------------------------------------------
# Helpers de módulo
# ---------------------------------------------------------------------------
def compose_song(params: SongParams) -> List[Section]:
    """Atajo de módulo para crear un SectionComposer y componer."""
    return SectionComposer(params).compose()


def compose_from_dict(data: Dict[str, Any]) -> List[Section]:
    """Crea secciones a partir de un diccionario de parámetros raw."""
    params = SongParams(
        genre            = data.get("genre",    "pop"),
        mood             = data.get("mood",     "neutral"),
        language         = data.get("language", "english"),
        duration_seconds = data.get("duration", 180),
        lyrics           = data.get("lyrics"),
        bpm              = data.get("bpm"),
    )
    return compose_song(params)
