#!/usr/bin/env python3
"""A/B de calidad para Music Lab: mismas canciones, distintos presets.

Por cada (prueba x preset) manda un job a /v1/generate, espera el resultado,
descarga el audio y mide: tiempo total, gpu_seconds y fases (metadata del
servidor), LUFS/pico/clipping y, para canciones con letra, inteligibilidad
via Whisper (WER contra la letra original). Escribe results.csv + audios.

IMPORTANTE: un servidor Music Lab carga UN solo modelo (ACE_STEP_CONFIG_PATH).
Un preset que exige otro modelo se rechaza con 422 y queda registrado en el CSV
como fallo, sin abortar. Para comparar turbo vs xl_turbo hay que correr el
script dos veces, apuntando a dos servidores (o reiniciando con otro config):

    python scripts/ab_quality.py --url http://host:8002 --presets turbo,turbo_lm
    python scripts/ab_quality.py --url http://host2:8002 --presets xl_turbo

Dependencias: httpx y soundfile (ya en requirements). Opcionales:
pyloudnorm (LUFS) y faster-whisper (WER). Sin ellas esas columnas quedan vacías.

    MUSIC_LAB_API_KEY=... python scripts/ab_quality.py --url http://localhost:8002
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
TAG_RE = re.compile(r"\[[^\]]*\]")
FIELDS = [
    "test", "preset", "ok", "error", "duration_s", "wall_s", "gpu_seconds",
    "diffusion_s", "decode_s", "lm_s", "mastering_s", "peak_vram_gb", "dtype",
    "lufs", "peak_dbfs", "clipping_pct", "wer", "audio_file",
]


def normalize_text(text: str) -> list[str]:
    """Minúsculas, sin etiquetas [verse], sin acentos ni puntuación."""
    text = TAG_RE.sub(" ", text.lower())
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9ñ\s]", " ", text)
    return text.split()


def wer(reference: list[str], hypothesis: list[str]) -> float | None:
    """Word error rate por distancia de edición. None si no hay referencia."""
    if not reference:
        return None
    prev = list(range(len(hypothesis) + 1))
    for i, ref_word in enumerate(reference, start=1):
        cur = [i] + [0] * len(hypothesis)
        for j, hyp_word in enumerate(hypothesis, start=1):
            cost = 0 if ref_word == hyp_word else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return round(prev[-1] / len(reference), 4)


def audio_metrics(path: Path) -> dict[str, float | None]:
    out: dict[str, float | None] = {"lufs": None, "peak_dbfs": None, "clipping_pct": None}
    try:
        import numpy as np
        import soundfile as sf

        data, rate = sf.read(str(path), always_2d=True)
        peak = float(np.max(np.abs(data))) if data.size else 0.0
        out["peak_dbfs"] = round(20 * np.log10(peak), 2) if peak > 0 else None
        out["clipping_pct"] = round(float(np.mean(np.abs(data) >= 0.999)) * 100, 4)
        try:
            import pyloudnorm as pyln

            out["lufs"] = round(float(pyln.Meter(rate).integrated_loudness(data)), 2)
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001 - métricas opcionales
        print(f"  (métricas de audio no disponibles: {exc})", file=sys.stderr)
    return out


def load_audio_16k(path: Path) -> Any:
    """WAV/MP3 -> float32 mono a 16 kHz (formato que espera Whisper)."""
    from math import gcd

    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly

    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if rate != 16_000:
        g = gcd(int(rate), 16_000)
        mono = resample_poly(mono, 16_000 // g, int(rate) // g)
    return np.ascontiguousarray(mono, dtype=np.float32)


class Transcriber:
    def __init__(self, model_name: str, enabled: bool) -> None:
        self.model: Any | None = None
        if not enabled:
            return
        try:
            from faster_whisper import WhisperModel

            # WHISPER_DEVICE=cpu evita pelear VRAM/cuDNN con ACE-Step en la misma GPU.
            device = os.environ.get("WHISPER_DEVICE", "auto")
            compute = "int8" if device == "cpu" else "default"
            self.model = WhisperModel(model_name, device=device, compute_type=compute)
            print(f"Whisper '{model_name}' cargado (device={device}).")
        except Exception as exc:  # noqa: BLE001
            print(f"Whisper no disponible, se omite WER: {exc}", file=sys.stderr)

    def words(self, path: Path, language: str) -> list[str] | None:
        if self.model is None:
            return None
        # Se pasa un array 16 kHz mono en vez de la ruta: evita el decodificador PyAV de
        # faster-whisper, que falla en entornos con 'av' viejo ("metadata_errors").
        segments, _ = self.model.transcribe(load_audio_16k(path), language=language, vad_filter=False)
        return normalize_text(" ".join(s.text for s in segments))


def run_job(client: httpx.Client, payload: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    response = client.post("/v1/generate", json=payload)
    if response.status_code != 202:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:300]
        raise RuntimeError(f"HTTP {response.status_code}: {json.dumps(detail, ensure_ascii=False)[:300]}")
    job_id = response.json()["job_id"]
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        job = client.get(f"/v1/jobs/{job_id}").json()
        if job["status"] == "succeeded":
            return job
        if job["status"] in {"failed", "cancelled"}:
            err = job.get("error") or {}
            raise RuntimeError(f"job {job['status']}: {err.get('code')} {err.get('message')}")
        time.sleep(3)
    raise TimeoutError(f"job {job_id} excedió {timeout_s:.0f}s")


def compute_fields(job: dict[str, Any]) -> dict[str, Any]:
    result = job.get("result") or {}
    meta = result.get("metadata") or {}
    compute = meta.get("compute") or {}
    by_phase = compute.get("gpu_seconds_by_phase") or {}
    phases = compute.get("phase_seconds") or {}
    peak = compute.get("peak_vram_bytes")
    return {
        "gpu_seconds": compute.get("gpu_seconds"),
        "diffusion_s": phases.get("diffusion", by_phase.get("diffusion")),
        "decode_s": phases.get("decode", by_phase.get("decode")),
        "lm_s": phases.get("lm", by_phase.get("lm")),
        "mastering_s": phases.get("mastering", by_phase.get("mastering")),
        "peak_vram_gb": round(peak / 2**30, 2) if isinstance(peak, (int, float)) else None,
        "dtype": meta.get("dtype") or meta.get("effective_dtype"),
        "duration_s": result.get("duration_s"),
    }


def wer_only(folder: Path, tests_path: Path, args: argparse.Namespace) -> int:
    """Calcula WER sobre audios existentes (nombre: <preset>__<prueba>.<wav|mp3>)."""
    lyrics_by_test = {t["name"]: t.get("lyrics") or "" for t in json.loads(tests_path.read_text(encoding="utf-8"))}
    transcriber = Transcriber(args.whisper_model, enabled=True)
    if transcriber.model is None:
        print("Whisper no disponible.", file=sys.stderr)
        return 1
    rows = []
    for audio in sorted(folder.glob("*__*.*")):
        if audio.suffix.lower() not in {".wav", ".mp3"}:
            continue
        preset, _, name = audio.stem.partition("__")
        lyrics = lyrics_by_test.get(name, "")
        if not lyrics.strip() or lyrics.strip().lower() == "[instrumental]":
            continue
        hyp = transcriber.words(audio, args.language) or []
        score = wer(normalize_text(lyrics), hyp)
        rows.append({"preset": preset, "test": name, "wer": score, "transcripcion": " ".join(hyp)[:400]})
        print(f"  {preset:>10} {name:<22} WER={score}")
    out_csv = folder / "wer_results.csv"
    with out_csv.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["preset", "test", "wer", "transcripcion"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Escrito {out_csv}")
    return 0 if rows else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("MUSIC_LAB_URL", "http://localhost:8002"))
    ap.add_argument("--api-key", default=os.environ.get("MUSIC_LAB_API_KEY", ""))
    ap.add_argument("--presets", default="turbo", help="lista separada por comas; 'none' = sin preset")
    ap.add_argument("--tests", default=str(HERE / "ab_tests_es.json"))
    ap.add_argument("--only", default="", help="nombres de prueba separados por comas")
    ap.add_argument("--label", default="", help="etiqueta para nombrar audios/filas cuando no hay preset "
                    "(p. ej. xl_turbo si el servidor se arrancó con ACE_STEP_CONFIG_PATH=acestep-v15-xl-turbo)")
    ap.add_argument("--duration", type=float, default=180, help="duración (s) para todas; 0 = la de cada prueba")
    ap.add_argument("--master", action="store_true", help="aplica masterización (-14 LUFS)")
    ap.add_argument("--out", default="ab_results")
    ap.add_argument("--language", default="es")
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument("--no-whisper", action="store_true")
    ap.add_argument("--wer-from", default="", help="carpeta con audios ya generados (<preset>__<prueba>.wav): "
                    "solo calcula WER y escribe wer_results.csv, sin tocar el servidor")
    ap.add_argument("--timeout", type=float, default=2400)
    args = ap.parse_args()

    if args.wer_from:
        return wer_only(Path(args.wer_from), Path(args.tests), args)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tests = json.loads(Path(args.tests).read_text(encoding="utf-8"))
    if args.only:
        wanted = {n.strip() for n in args.only.split(",")}
        tests = [t for t in tests if t["name"] in wanted]
    presets: list[str | None] = [
        None if p.strip().lower() == "none" else p.strip() for p in args.presets.split(",") if p.strip()
    ]
    headers = {"x-api-key": args.api_key} if args.api_key else {}
    transcriber = Transcriber(args.whisper_model, enabled=not args.no_whisper)

    csv_path = out / "results.csv"
    rows: list[dict[str, Any]] = []
    with httpx.Client(base_url=args.url, headers=headers, timeout=60.0) as client:
        health = client.get("/health")
        print("health:", health.status_code, health.text[:300])
        for preset in presets:
            for test in tests:
                label = preset or args.label or "default"
                row: dict[str, Any] = {k: "" for k in FIELDS}
                row.update(test=test["name"], preset=label, ok=False)
                payload = {
                    k: test[k]
                    for k in ("prompt", "lyrics", "bpm", "key", "style_tags", "seed", "duration_s")
                    if k in test
                }
                if args.duration:
                    payload["duration_s"] = args.duration
                payload["master"] = args.master
                if preset:
                    payload["quality_preset"] = preset
                print(f"[{label}] {test['name']} ...", flush=True)
                started = time.monotonic()
                try:
                    job = run_job(client, payload, args.timeout)
                    row["wall_s"] = round(time.monotonic() - started, 1)
                    row.update(compute_fields(job))
                    audio = client.get(f"/v1/jobs/{job['job_id']}/audio")
                    audio.raise_for_status()
                    ext = "mp3" if "mpeg" in audio.headers.get("content-type", "") else "wav"
                    path = out / f"{label}__{test['name']}.{ext}"
                    path.write_bytes(audio.content)
                    row["audio_file"] = path.name
                    row.update(audio_metrics(path))
                    lyrics = test.get("lyrics") or ""
                    if lyrics.strip() and lyrics.strip().lower() != "[instrumental]":
                        hyp = transcriber.words(path, args.language)
                        if hyp is not None:
                            row["wer"] = wer(normalize_text(lyrics), hyp)
                    row["ok"] = True
                except Exception as exc:  # noqa: BLE001 - un fallo no aborta la batería
                    row["error"] = str(exc)[:300]
                    print(f"  FALLÓ: {row['error']}", file=sys.stderr)
                rows.append(row)
                with csv_path.open("w", newline="", encoding="utf-8") as fh:
                    writer = csv.DictWriter(fh, fieldnames=FIELDS)
                    writer.writeheader()
                    writer.writerows(rows)

    ok = [r for r in rows if r["ok"]]
    print(f"\n{len(ok)}/{len(rows)} correctas. Resultados: {csv_path}")
    for r in rows:
        print(
            f"  {r['preset']:>10} {r['test']:<22} ok={r['ok']!s:<5} wall={r['wall_s']}s "
            f"gpu={r['gpu_seconds']} lufs={r['lufs']} wer={r['wer']}"
        )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
