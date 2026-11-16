"""
──────────────────────────────────────────────────────────────────────────────
SON1KVERSE — song_structure.py
Definición de estructura de canción por secciones (Intro, Verse, Chorus, etc.)
y utilidades para mapear letras a secciones musicales.
──────────────────────────────────────────────────────────────────────────────
"""
from dataclasses import dataclass
from typing import List, Optional
import re


@dataclass
class SongSection:
    """Sección estructural de una canción."""
    name: str           # intro, verse, chorus, bridge, outro, pre_chorus, post_chorus
    duration_s: int     # duración objetivo en segundos
    emotion: str        # estado de ánimo de la sección (melancholic, energetic, calm, etc.)
    bpm_offset: int     # variación de BPM respecto al base (-4, 0, +2, etc.)
    energy: float       # 0.0 (suave) a 1.0 (energético)
    lyrics_hint: str    # tipo de letra esperada ("narrativa", "gancho", "instrumental", etc.)


# ─── Estructura estándar de canción pop/electrónica ─────────────────────────

DEFAULT_STRUCTURE: List[SongSection] = [
    SongSection("intro",      8,  "calm",       0,    0.4, "instrumental"),
    SongSection("verse_1",   16,  "melancholic", 0,   0.6, "narrativa"),
    SongSection("pre_chorus", 8,  "tense",       2,    0.8, "preparación"),
    SongSection("chorus",    16,  "energetic",  0,    1.0, "gancho principal"),
    SongSection("verse_2",   16,  "melancholic", 0,   0.6, "narrativa continua"),
    SongSection("chorus",    16,  "energetic",  0,    1.0, "repetición gancho"),
    SongSection("bridge",     8,  "aggressive", -4,   0.9, "cambio de tensión"),
    SongSection("outro",     12,  "calm",       0,    0.3, "desvanecimiento"),
]


# Mapeo de emociones a moods válidos para HeartMuLa
EMOTION_TO_MOOD = {
    "calm":         "calm",
    "melancholic":  "melancholic",
    "tense":        "tense",
    "energetic":    "energetic",
    "aggressive":   "aggressive",
    "hopeful":      "hopeful",
    "romantic":     "romantic",
    "dark":         "dark",
}


def compute_structure(total_duration_s: int) -> List[SongSection]:
    """
    Escala la estructura estándar a la duración objetivo total.
    Cada sección se ajusta proporcionalmente manteniendo el orden.
    """
    total_std = sum(s.duration_s for s in DEFAULT_STRUCTURE)
    if total_duration_s <= 0:
        return DEFAULT_STRUCTURE.copy()

    ratio = total_duration_s / total_std
    sections = []
    for s in DEFAULT_STRUCTURE:
        dur = max(4, int(round(s.duration_s * ratio)))
        sections.append(SongSection(
            name=s.name,
            duration_s=dur,
            emotion=s.emotion,
            bpm_offset=s.bpm_offset,
            energy=s.energy,
            lyrics_hint=s.lyrics_hint,
        ))
    return sections


def split_lyrics_by_sections(lyrics: str, sections: List[SongSection]) -> List[str]:
    """
    Divide una letra en fragmentos según los marcadores de sección [Verse], [Chorus], etc.
    Si no hay marcadores, reparte la letra equitativamente entre las secciones vocales.
    """
    if not lyrics or not lyrics.strip():
        return [""] * len(sections)

    lines = [ln.strip() for ln in lyrics.splitlines() if ln.strip()]
    if not lines:
        return [""] * len(sections)

    # Detectar marcadores de sección [Nombre]
    section_pattern = re.compile(r"^\[(\w+)\]$", re.IGNORECASE)

    vocal_sections = [
        i for i, s in enumerate(sections)
        if s.name.lower() in {"verse", "chorus", "bridge", "pre_chorus", "post_chorus", "outro"}
    ]

    # Si no hay marcadores, repartir equitativamente entre secciones vocales
    if not any(section_pattern.match(line) for line in lines):
        if not vocal_sections:
            vocal_sections = list(range(len(sections)))
        n = len(vocal_sections)
        per = max(1, len(lines) // n)
        assigned: dict[int, str] = {}
        for k, idx in enumerate(vocal_sections):
            start = k * per
            end = len(lines) if k == n - 1 else min(len(lines), (k + 1) * per)
            assigned[idx] = "\n".join(lines[start:end])
        return [assigned.get(i, "") for i in range(len(sections))]

    # Si hay marcadores, asignar líneas a la sección correspondiente
    section_map: dict[str, List[str]] = {s.name: [] for s in sections}
    current_section = sections[0].name if sections else "intro"

    for line in lines:
        match = section_pattern.match(line)
        if match:
            current_section = match.group(1).lower()
        else:
            section_map.setdefault(current_section, []).append(line)

    # Construir resultado en orden de sections
    result: List[str] = []
    for s in sections:
        text = "\n".join(section_map.get(s.name, []))
        result.append(text)

    return result


def section_to_generate_params(
    section: SongSection,
    base_genre: str,
    base_mood: str,
    base_language: str,
    base_bpm: Optional[int] = None,
    lyrics: Optional[str] = None,
) -> dict:
    """
    Convierte una SongSection en parámetros de generación para AudioEngineClient.
    """
    mood = EMOTION_TO_MOOD.get(section.emotion, base_mood)
    bpm = None
    if base_bpm is not None:
        bpm = max(40, min(250, base_bpm + section.bpm_offset))

    return {
        "genre": base_genre,
        "mood": mood,
        "language": base_language,
        "duration_seconds": section.duration_s,
        "lyrics": lyrics,
        "bpm": bpm,
        "title": f"{section.name}",
        "section_name": section.name,
        "section_emotion": section.emotion,
        "section_energy": section.energy,
        "skip_mastering": True,  # mastering se hace al final en la concatenación
        "skip_analysis": True,
    }
