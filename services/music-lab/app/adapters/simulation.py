"""Deterministic CPU-only simulation adapter.

The generated audio is a simple synthesizer arrangement (pads, bass and
synthetic percussion). It is intentionally lightweight, reproducible by seed
and free of model downloads or external APIs.
"""

from __future__ import annotations

import asyncio
import math
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.adapters.base import AudioGeneratorInterface
from app.audio import (
    ensure_stereo,
    read_audio,
    resample_if_needed,
    resolve_output_file,
    write_audio,
)
from app.config import Settings, get_settings
from app.errors import InvalidRequestError
from app.schemas import (
    AdapterHealth,
    CoverRequest,
    EngineName,
    GenerateRequest,
    GenerationResult,
    OutputFormat,
    RepaintRequest,
    StemsRequest,
    StemsResult,
)

_NOTE_OFFSETS = {
    "C": 0,
    "C#": 1,
    "DB": 1,
    "D": 2,
    "D#": 3,
    "EB": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "GB": 6,
    "G": 7,
    "G#": 8,
    "AB": 8,
    "A": 9,
    "A#": 10,
    "BB": 10,
    "B": 11,
}
_KEY_RE = re.compile(r"^\s*([A-Ga-g])([#bB]?)([^#bB]*)\s*$")
_AMBIENT_TAGS = {"ambient", "cinematic", "downtempo", "lofi", "lo-fi"}
_DENSE_TAGS = {"techno", "house", "edm", "electronic", "trance"}


@dataclass(slots=True)
class RenderedAudio:
    mix: np.ndarray
    drums: np.ndarray
    bass: np.ndarray
    other: np.ndarray
    sample_rate: int
    duration_s: float


def parse_key(key: str) -> tuple[int, bool]:
    """Return (semitone offset from C, is_minor)."""
    match = _KEY_RE.match(key)
    if match is None:
        return 0, False
    note = f"{match.group(1).upper()}{match.group(2).upper().replace('B', 'b')}"
    note = note.replace("b", "B") if len(note) > 1 else note
    offset = _NOTE_OFFSETS.get(note.upper(), 0)
    suffix = match.group(3).strip().lower()
    is_minor = suffix.startswith("m") and not suffix.startswith("maj")
    return offset, is_minor


def _midi_to_hz(midi: float) -> float:
    return float(440.0 * (2.0 ** ((midi - 69.0) / 12.0)))


def _progression(is_minor: bool) -> list[int]:
    return [0, 3, 7, 5] if is_minor else [0, 5, 7, 9]


def _add_pads(
    track: np.ndarray,
    sample_rate: int,
    duration_s: float,
    root_midi: int,
    is_minor: bool,
    bpm: int,
) -> None:
    samples = track.shape[1]
    bar_s = 4.0 * 60.0 / bpm
    bars = max(1, math.ceil(duration_s / bar_s))
    chord = (0.0, 3.0, 7.0) if is_minor else (0.0, 4.0, 7.0)
    intervals = _progression(is_minor)
    for bar in range(bars):
        start = int(round(bar * bar_s * sample_rate))
        if start >= samples:
            break
        end = min(samples, int(round((bar + 1) * bar_s * sample_rate)))
        local = np.arange(end - start, dtype=np.float32) / sample_rate
        envelope = np.ones_like(local)
        attack = min(len(local), max(1, int(0.04 * sample_rate)))
        release = min(len(local), max(1, int(0.18 * sample_rate)))
        envelope[:attack] = np.linspace(0.0, 1.0, attack, dtype=np.float32)
        envelope[-release:] *= np.linspace(1.0, 0.0, release, dtype=np.float32)
        root = root_midi + intervals[bar % len(intervals)]
        left = np.zeros_like(local)
        right = np.zeros_like(local)
        for interval in chord:
            frequency = _midi_to_hz(root + interval)
            left += np.sin(2.0 * np.pi * frequency * 1.0015 * local)
            left += 0.22 * np.sin(2.0 * np.pi * frequency * 2.0 * local)
            right += np.sin(2.0 * np.pi * frequency * 0.9985 * local)
            right += 0.22 * np.sin(2.0 * np.pi * frequency * 2.0 * local)
        gain = 0.085 / len(chord)
        track[0, start:end] += (left * envelope * gain).astype(np.float32)
        track[1, start:end] += (right * envelope * gain).astype(np.float32)


def _add_bass(
    track: np.ndarray,
    sample_rate: int,
    duration_s: float,
    root_midi: int,
    is_minor: bool,
    bpm: int,
) -> None:
    samples = track.shape[1]
    beat_s = 60.0 / bpm
    beats = max(1, math.ceil(duration_s / beat_s))
    interval_scale = _progression(is_minor)
    for beat in range(beats):
        start = int(round(beat * beat_s * sample_rate))
        if start >= samples:
            break
        length_s = min(beat_s * 0.9, duration_s - beat * beat_s)
        end = min(samples, start + max(1, int(round(length_s * sample_rate))))
        local = np.arange(end - start, dtype=np.float32) / sample_rate
        envelope = np.exp(-2.6 * local / max(beat_s, 1e-6)).astype(np.float32)
        attack = min(len(local), max(1, int(0.008 * sample_rate)))
        envelope[:attack] *= np.linspace(0.0, 1.0, attack, dtype=np.float32)
        bar = beat // 4
        note = root_midi + interval_scale[bar % len(interval_scale)] - 12
        frequency = _midi_to_hz(note)
        wave = np.sin(2.0 * np.pi * frequency * local)
        wave += 0.25 * np.sin(2.0 * np.pi * frequency * 2.0 * local)
        signal = (0.30 * wave * envelope).astype(np.float32)
        track[0, start:end] += signal
        track[1, start:end] += signal


def _add_drums(
    track: np.ndarray,
    sample_rate: int,
    duration_s: float,
    bpm: int,
    rng: np.random.Generator,
    style_tags: list[str],
) -> None:
    samples = track.shape[1]
    beat_s = 60.0 / bpm
    beats = max(1, math.ceil(duration_s / beat_s))
    tags = {tag.lower().strip() for tag in style_tags}
    ambience = 0.35 if tags & _AMBIENT_TAGS else 1.0
    dense = 1.0 if tags & _DENSE_TAGS else 0.8

    for beat in range(beats):
        start = int(round(beat * beat_s * sample_rate))
        if start >= samples:
            break
        kick_len = min(samples - start, max(1, int(0.22 * sample_rate)))
        local = np.arange(kick_len, dtype=np.float32) / sample_rate
        phase = 2.0 * np.pi * (45.0 * local + (80.0 / 20.0) * (1.0 - np.exp(-20.0 * local)))
        kick = (0.42 * np.sin(phase) * np.exp(-8.0 * local) * ambience).astype(np.float32)
        track[0, start : start + kick_len] += kick
        track[1, start : start + kick_len] += kick

        if beat % 4 in (1, 3):
            snare_len = min(samples - start, max(1, int(0.16 * sample_rate)))
            local = np.arange(snare_len, dtype=np.float32) / sample_rate
            noise = rng.standard_normal(snare_len).astype(np.float32)
            body = np.sin(2.0 * np.pi * 185.0 * local).astype(np.float32)
            snare = (noise * 0.55 + body * 0.45) * np.exp(-24.0 * local) * 0.20 * ambience
            track[0, start : start + snare_len] += snare
            track[1, start : start + snare_len] += snare

        hat_step = 0.5 if dense > 0.5 else 1.0
        steps = max(1, int(round(1.0 / hat_step)))
        for step in range(steps):
            hat_start = start + int(round(step * beat_s * hat_step * sample_rate))
            if hat_start >= samples:
                break
            hat_len = min(samples - hat_start, max(1, int(0.05 * sample_rate)))
            local = np.arange(hat_len, dtype=np.float32) / sample_rate
            noise = rng.standard_normal(hat_len).astype(np.float32)
            hat = (noise * np.exp(-90.0 * local) * 0.045 * ambience).astype(np.float32)
            track[0, hat_start : hat_start + hat_len] += hat
            track[1, hat_start : hat_start + hat_len] += hat


def render_simulation(req: GenerateRequest | RepaintRequest | CoverRequest | StemsRequest,
                      sample_rate: int) -> RenderedAudio:
    duration_s = float(req.duration_s)
    samples = max(1, int(round(duration_s * sample_rate)))
    drums = np.zeros((2, samples), dtype=np.float32)
    bass = np.zeros((2, samples), dtype=np.float32)
    other = np.zeros((2, samples), dtype=np.float32)

    offset, is_minor = parse_key(req.key)
    root_midi = 48 + offset
    rng = np.random.default_rng(req.seed)

    _add_pads(other, sample_rate, duration_s, root_midi, is_minor, req.bpm)
    _add_bass(bass, sample_rate, duration_s, root_midi, is_minor, req.bpm)
    _add_drums(drums, sample_rate, duration_s, req.bpm, rng, req.style_tags)

    mix = drums + bass + other
    peak = float(np.max(np.abs(mix)))
    if peak > 1e-9:
        scale = np.float32(0.85 / peak)
        drums *= scale
        bass *= scale
        other *= scale
        mix = drums + bass + other

    fade_in = min(samples, max(1, int(0.05 * sample_rate)))
    fade_out = min(samples, max(1, int(0.12 * sample_rate)))
    envelope = np.ones(samples, dtype=np.float32)
    envelope[:fade_in] = np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    envelope[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    for track in (drums, bass, other):
        track *= envelope
    mix = drums + bass + other

    return RenderedAudio(
        mix=ensure_stereo(mix),
        drums=drums,
        bass=bass,
        other=other,
        sample_rate=sample_rate,
        duration_s=samples / sample_rate,
    )


class SimulationAdapter(AudioGeneratorInterface):
    engine = EngineName.SIMULATION
    supported_methods = frozenset({"generate", "repaint", "cover", "stems"})

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._sample_rate = self._settings.music_lab_sample_rate
        self._output_dir = self._settings.music_lab_output_dir

    async def _simulate_latency(self) -> None:
        if self._settings.sim_latency_ms > 0:
            await asyncio.sleep(self._settings.sim_latency_ms / 1000.0)

    def _job_dir(self, job_id: str) -> Path:
        directory = self._output_dir / f"sim-{job_id}"
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _path_for(self, job_id: str, name: str, output_format: OutputFormat) -> Path:
        return self._job_dir(job_id) / f"{name}.{output_format.value}"

    def _metadata(self, req: GenerateRequest, operation: str) -> dict[str, object]:
        return {
            "synthetic": True,
            "operation": operation,
            "prompt": req.prompt,
            "seed": req.seed,
            "bpm": req.bpm,
            "key": req.key,
            "style_tags": list(req.style_tags),
            "reference_audio_path": req.reference_audio_path,
        }

    async def generate(self, req: GenerateRequest) -> GenerationResult:
        await self._simulate_latency()
        job_id = uuid.uuid4().hex
        rendered = await asyncio.to_thread(render_simulation, req, self._sample_rate)
        path = await asyncio.to_thread(
            write_audio,
            self._path_for(job_id, "generate", req.output_format),
            rendered.mix,
            rendered.sample_rate,
            req.output_format,
        )
        metadata = self._metadata(req, "generate")
        metadata.update({"drums_peak": _peak(rendered.drums), "bass_peak": _peak(rendered.bass)})
        return GenerationResult(
            job_id=job_id,
            audio_path=str(path),
            duration_s=round(rendered.duration_s, 6),
            sample_rate=rendered.sample_rate,
            engine=self.engine,
            mode=self.engine,
            output_format=req.output_format,
            metadata=metadata,
        )

    async def repaint(self, req: RepaintRequest) -> GenerationResult:
        await self._simulate_latency()
        job_id = uuid.uuid4().hex
        source = resolve_output_file(req.source_audio_path, self._output_dir)
        audio, source_sr = read_audio(source)
        audio = resample_if_needed(audio, source_sr, self._sample_rate)
        source_duration = audio.shape[1] / self._sample_rate
        if req.start_s >= source_duration:
            raise InvalidRequestError(
                "start_s is outside the source audio",
                details={"start_s": req.start_s, "duration_s": source_duration},
            )
        end_s = min(req.end_s, source_duration)
        start_sample = int(round(req.start_s * self._sample_rate))
        end_sample = int(round(end_s * self._sample_rate))
        if end_sample <= start_sample:
            raise InvalidRequestError("Repaint range is empty")

        replacement_duration = (end_sample - start_sample) / self._sample_rate
        replacement_req = req.model_copy(
            update={
                "duration_s": replacement_duration,
                "seed": req.seed ^ (start_sample & 0xFFFFFFFF),
                "master": False,
            }
        )
        rendered = await asyncio.to_thread(render_simulation, replacement_req, self._sample_rate)
        replacement = rendered.mix[:, : end_sample - start_sample]
        if replacement.shape[1] < end_sample - start_sample:
            replacement = np.pad(
                replacement,
                ((0, 0), (0, end_sample - start_sample - replacement.shape[1])),
            )

        edge = min(replacement.shape[1] // 2, max(1, int(0.005 * self._sample_rate)))
        replacement = replacement.copy()
        replacement[:, :edge] *= np.linspace(0.0, 1.0, edge, dtype=np.float32)
        replacement[:, -edge:] *= np.linspace(1.0, 0.0, edge, dtype=np.float32)

        output = audio.copy()
        output[:, start_sample:end_sample] = replacement
        path = await asyncio.to_thread(
            write_audio,
            self._path_for(job_id, "repaint", req.output_format),
            output,
            self._sample_rate,
            req.output_format,
        )
        metadata = self._metadata(req, "repaint")
        metadata.update(
            {
                "source_audio_path": str(source),
                "start_s": req.start_s,
                "end_s": end_s,
                "replacement_seed": replacement_req.seed,
            }
        )
        return GenerationResult(
            job_id=job_id,
            audio_path=str(path),
            duration_s=round(source_duration, 6),
            sample_rate=self._sample_rate,
            engine=self.engine,
            mode=self.engine,
            output_format=req.output_format,
            metadata=metadata,
        )

    async def cover(self, req: CoverRequest) -> GenerationResult:
        await self._simulate_latency()
        job_id = uuid.uuid4().hex
        source = resolve_output_file(req.source_audio_path, self._output_dir)
        audio, source_sr = read_audio(source)
        audio = resample_if_needed(audio, source_sr, self._sample_rate)
        source_duration = audio.shape[1] / self._sample_rate
        cover_req = req.model_copy(update={"duration_s": source_duration, "master": False})
        rendered = await asyncio.to_thread(render_simulation, cover_req, self._sample_rate)
        path = await asyncio.to_thread(
            write_audio,
            self._path_for(job_id, "cover", req.output_format),
            rendered.mix,
            rendered.sample_rate,
            req.output_format,
        )
        metadata = self._metadata(req, "cover")
        metadata.update({"source_audio_path": str(source), "target_key": req.key})
        return GenerationResult(
            job_id=job_id,
            audio_path=str(path),
            duration_s=round(rendered.duration_s, 6),
            sample_rate=rendered.sample_rate,
            engine=self.engine,
            mode=self.engine,
            output_format=req.output_format,
            metadata=metadata,
        )

    async def stems(self, req: StemsRequest) -> StemsResult:
        await self._simulate_latency()
        job_id = uuid.uuid4().hex
        stem_dir = self._job_dir(job_id)
        if req.source_audio_path:
            source = resolve_output_file(req.source_audio_path, self._output_dir)
            audio, source_sr = read_audio(source)
            audio = resample_if_needed(audio, source_sr, self._sample_rate)
            duration = audio.shape[1] / self._sample_rate
            drums, bass, other = await asyncio.to_thread(_split_bands, audio, self._sample_rate)
            source_metadata: dict[str, object] = {"source_audio_path": str(source)}
        else:
            rendered = await asyncio.to_thread(render_simulation, req, self._sample_rate)
            drums, bass, other = rendered.drums, rendered.bass, rendered.other
            duration = rendered.duration_s
            source_metadata = {"source_audio_path": None}

        paths = {
            "drums": write_audio(
                stem_dir / f"drums.{req.output_format.value}",
                drums,
                self._sample_rate,
                req.output_format,
            ),
            "bass": write_audio(
                stem_dir / f"bass.{req.output_format.value}",
                bass,
                self._sample_rate,
                req.output_format,
            ),
            "other": write_audio(
                stem_dir / f"other.{req.output_format.value}",
                other,
                self._sample_rate,
                req.output_format,
            ),
        }
        metadata = self._metadata(req, "stems")
        metadata.update(source_metadata)
        return StemsResult(
            job_id=job_id,
            stems={name: str(path) for name, path in paths.items()},
            duration_s=round(duration, 6),
            sample_rate=self._sample_rate,
            engine=self.engine,
            mode=self.engine,
            metadata=metadata,
        )

    async def health(self) -> AdapterHealth:
        return AdapterHealth(
            engine=self.engine,
            ready=True,
            device="cpu",
            details={
                "synthetic": True,
                "sample_rate": self._sample_rate,
                "latency_ms": self._settings.sim_latency_ms,
            },
        )

    async def capabilities(self) -> set[str]:
        return set(self.supported_methods)


def _peak(audio: np.ndarray) -> float:
    return round(float(np.max(np.abs(audio))), 6) if audio.size else 0.0


def _split_bands(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split a mix into low (bass), high (drums) and residual (other) bands."""
    from scipy.signal import butter, sosfilt

    nyquist = sample_rate / 2.0
    bass_sos = butter(4, min(220.0, nyquist * 0.9) / nyquist, btype="lowpass", output="sos")
    drums_sos = butter(4, min(4000.0, nyquist * 0.9) / nyquist, btype="highpass", output="sos")
    bass = np.stack([sosfilt(bass_sos, channel) for channel in audio]).astype(np.float32)
    drums = np.stack([sosfilt(drums_sos, channel) for channel in audio]).astype(np.float32)
    other = (audio - bass - drums).astype(np.float32)
    return drums, bass, other

