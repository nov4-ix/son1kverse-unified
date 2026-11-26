#!/usr/bin/env python3
"""Compara modelos de música alojados en deAPI con las mismas 5 pruebas en español.

Flujo (docs.deapi.ai, API v2): POST /api/v2/audio/music (multipart) -> request_id ->
GET /api/v2/jobs/{id} hasta status=done -> descarga de result_url. Guarda audios como
<modelo>__<prueba>.mp3 y results_deapi.csv (precio, tiempo, LUFS, pico, clipping, WER opcional).
Los audios sirven también con:  python scripts/ab_quality.py --wer-from <carpeta>

La API key va SOLO por entorno (nunca por argumento ni en el repo):
    export DEAPI_API_KEY=...            # token de app.deapi.ai

Pasos recomendados (el 1 no gasta nada):
    python scripts/ab_deapi.py --list-models
    python scripts/ab_deapi.py --dry-run --models AceStep_1_5_XL_Turbo_INT8
    python scripts/ab_deapi.py --models AceStep_1_5_XL_Turbo_INT8 --only reggaeton_oscuro --max-credits 0.5
    python scripts/ab_deapi.py --models AceStep_1_5_XL_Turbo_INT8,MiniMaxMusic3_11B_INT8 --max-credits 1
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ab_quality import Transcriber, audio_metrics, normalize_text, wer  # noqa: E402

HERE = Path(__file__).resolve().parent
BASE_URL_DEFAULT = "https://api.deapi.ai"
FIELDS = ["test", "model", "ok", "error", "wall_s", "price_credits", "duration_s_req",
          "lufs", "peak_dbfs", "clipping_pct", "wer", "audio_file"]
# Parámetros que la doc fija por modelo (guidance_scale y steps son model-specific).
MODEL_DEFAULTS = [
    ("minimax", {"steps": 30, "guidance": 1.7}),
    ("turbo", {"steps": 8, "guidance": 1.0}),
    ("", {"steps": 32, "guidance": 7.0}),
]


def model_params(slug: str, steps: int | None, guidance: float | None) -> dict[str, Any]:
    low = slug.lower()
    for needle, params in MODEL_DEFAULTS:
        if needle in low:
            out = dict(params)
            break
    else:  # pragma: no cover
        out = {"steps": 8, "guidance": 1.0}
    if steps is not None:
        out["steps"] = steps
    if guidance is not None:
        out["guidance"] = guidance
    return out


def keyscale(key: str) -> str:
    """'Am' -> 'A minor', 'F' -> 'F major', 'C#m' -> 'C# minor'."""
    m = re.match(r"^\s*([A-Ga-g])([#b]?)\s*(m|min|minor)?\s*$", key)
    if not m:
        return key
    return f"{m.group(1).upper()}{m.group(2)} {'minor' if m.group(3) else 'major'}"


def form_fields(test: dict[str, Any], model: str, duration: float, language: str,
                steps: int, guidance: float) -> dict[str, str]:
    caption = test["prompt"]
    if test.get("style_tags"):
        caption += "; " + ", ".join(test["style_tags"])
    lyrics = (test.get("lyrics") or "").strip() or "[Instrumental]"
    if lyrics.lower() == "[instrumental]":
        lyrics = "[Instrumental]"
    fields = {
        "caption": caption[:512], "model": model, "lyrics": lyrics, "duration": str(duration),
        "inference_steps": str(steps), "guidance_scale": str(guidance),
        "seed": str(test.get("seed", -1)), "format": "mp3", "timesignature": "4",
        "vocal_language": language,
    }
    if test.get("bpm"):
        fields["bpm"] = str(test["bpm"])
    if test.get("key"):
        fields["keyscale"] = keyscale(test["key"])
    return fields


def as_multipart(fields: dict[str, str]) -> dict[str, tuple[None, str]]:
    return {k: (None, v) for k, v in fields.items()}  # multipart/form-data sin archivos


def extract_price(payload: dict[str, Any]) -> float | None:
    data = payload.get("data") or {}
    price = data.get("price")
    if isinstance(price, dict):
        price = price.get("amount")
    try:
        return float(price)
    except (TypeError, ValueError):
        return None


OPTIONAL_FIELDS = {"bpm", "keyscale", "timesignature", "vocal_language"}


def dropped_by_422(response: httpx.Response, fields: dict[str, str]) -> list[str]:
    """Campos opcionales que la API rechazó (422 con errors.<campo>); se pueden omitir y reintentar."""
    if response.status_code != 422:
        return []
    try:
        errors = (response.json() or {}).get("errors") or {}
    except ValueError:
        return []
    return [k for k in errors if k in OPTIONAL_FIELDS and k in fields]


def quote(client: httpx.Client, fields: dict[str, str]) -> tuple[float | None, dict[str, str], str | None]:
    """Cotiza; si un campo opcional no es válido para el modelo, lo quita y reintenta. -> (precio, campos, nota)."""
    note = None
    for _ in range(len(OPTIONAL_FIELDS) + 1):
        body = {
            k: (int(v) if k in {"inference_steps", "bpm", "timesignature"} and v.lstrip("-").isdigit()
                else float(v) if k in {"duration", "guidance_scale"} else v)
            for k, v in fields.items() if k not in {"seed", "format"}
        }
        q = client.post("/api/v2/audio/music/price", json=body)
        if q.status_code == 200:
            return extract_price(q.json()), fields, note
        bad = dropped_by_422(q, fields)
        if not bad:
            return None, fields, f"HTTP {q.status_code} {q.text[:200]}"
        fields = {k: v for k, v in fields.items() if k not in bad}
        note = "omitidos por el modelo: " + ",".join(bad)
    return None, fields, note


def list_models(client: httpx.Client) -> int:
    r = client.get("/api/v2/models")
    print("HTTP", r.status_code)
    try:
        body = r.json()
    except ValueError:
        print(r.text[:1500]); return 1
    wanted = re.compile(r"acestep|ace-step|minimax", re.I)
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, str) and wanted.search(node) and len(node) < 80:
            found.append(node)

    walk(body)
    if found:
        print("Modelos de música encontrados (úsalos en --models):")
        for slug in sorted(set(found)):
            print("  ", slug)
    else:
        print(json.dumps(body, ensure_ascii=False)[:2500])
    return 0


def submit_and_wait(client: httpx.Client, fields: dict[str, str], timeout_s: float) -> tuple[str, dict[str, Any]]:
    r = client.post("/api/v2/audio/music", files=as_multipart(fields))
    bad = dropped_by_422(r, fields)
    if bad:
        fields = {k: v for k, v in fields.items() if k not in bad}
        r = client.post("/api/v2/audio/music", files=as_multipart(fields))
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    request_id = r.json()["data"]["request_id"]
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        j = client.get(f"/api/v2/jobs/{request_id}")
        if j.status_code == 429:
            time.sleep(float(j.headers.get("Retry-After", "5"))); continue
        j.raise_for_status()
        data = j.json()["data"]
        if data.get("status") == "done":
            return request_id, data
        if data.get("status") == "error":
            raise RuntimeError(f"job error: {data.get('error_code')} {data.get('error_reason')} "
                               f"(retryable={data.get('retryable')}, refunded={data.get('refunded')})")
        time.sleep(4)
    raise TimeoutError(f"job {request_id} excedió {timeout_s:.0f}s")


def download(client: httpx.Client, url: str) -> bytes:
    # La doc no aclara si result_url exige token: primero sin él (no filtrar la key a terceros).
    with httpx.Client(timeout=120.0, follow_redirects=True) as anon:
        r = anon.get(url)
        if r.status_code in (401, 403):
            if httpx.URL(url).host != httpx.URL(str(client.base_url)).host:
                raise RuntimeError("result_url pide auth y es de otro host; no se envía la key")
            r = client.get(url)
        r.raise_for_status()
        return r.content


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=os.environ.get("DEAPI_BASE_URL", BASE_URL_DEFAULT))
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="solo cotiza (no cuesta); no genera")
    ap.add_argument("--models", default="AceStep_1_5_XL_Turbo_INT8")
    ap.add_argument("--tests", default=str(HERE / "ab_tests_es.json"))
    ap.add_argument("--only", default="")
    ap.add_argument("--duration", type=float, default=180)
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--guidance", type=float, default=None)
    ap.add_argument("--language", default="es")
    ap.add_argument("--max-credits", type=float, default=1.0, help="tope de gasto estimado de esta corrida")
    ap.add_argument("--out", default="ab_deapi_results")
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument("--no-whisper", action="store_true")
    ap.add_argument("--timeout", type=float, default=900)
    args = ap.parse_args()

    key = os.environ.get("DEAPI_API_KEY", "").strip()
    if not key:
        print("Falta DEAPI_API_KEY en el entorno (no se acepta por argumento).", file=sys.stderr)
        return 2
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)

    with httpx.Client(base_url=args.base_url, headers=headers, timeout=60.0) as client:
        if args.list_models:
            return list_models(client)
        tests = json.loads(Path(args.tests).read_text(encoding="utf-8"))
        if args.only:
            wanted = {n.strip() for n in args.only.split(",")}
            tests = [t for t in tests if t["name"] in wanted]
        models = [m.strip() for m in args.models.split(",") if m.strip()]
        transcriber = Transcriber(args.whisper_model, enabled=not (args.no_whisper or args.dry_run))

        # 1) Cotización previa de toda la corrida (no cuesta) y control del tope.
        plan, total = [], 0.0
        for model in models:
            p = model_params(model, args.steps, args.guidance)
            for t in tests:
                fields = form_fields(t, model, args.duration, args.language, p["steps"], p["guidance"])
                price, fields, note = quote(client, fields)
                if price is None or note:
                    print(f"  ({model}/{t['name']}): {note}", file=sys.stderr)
                plan.append((model, t, fields, price))
                total += price or 0.0
        print(f"Plan: {len(plan)} generaciones, costo estimado total: {total:.4f} créditos "
              f"(tope --max-credits {args.max_credits})")
        for model, t, _, price in plan:
            print(f"  {model:<32} {t['name']:<22} {price}")
        if args.dry_run:
            return 0
        if total > args.max_credits:
            print("El costo estimado supera --max-credits; no se genera nada. Sube el tope o reduce pruebas.",
                  file=sys.stderr)
            return 3

        # 2) Generación real.
        rows: list[dict[str, Any]] = []
        for model, t, fields, _ in plan:
            row: dict[str, Any] = {k: "" for k in FIELDS}
            row.update(test=t["name"], model=model, ok=False, duration_s_req=args.duration)
            print(f"[{model}] {t['name']} ...", flush=True)
            started = time.monotonic()
            try:
                _, data = submit_and_wait(client, fields, args.timeout)
                row["wall_s"] = round(time.monotonic() - started, 1)
                price = data.get("price") or {}
                row["price_credits"] = price.get("amount") if isinstance(price, dict) else price
                audio = download(client, data["result_url"])
                path = out / f"{model}__{t['name']}.mp3"
                path.write_bytes(audio)
                row["audio_file"] = path.name
                row.update(audio_metrics(path))
                lyrics = t.get("lyrics") or ""
                if lyrics.strip() and lyrics.strip().lower() != "[instrumental]":
                    hyp = transcriber.words(path, args.language)
                    if hyp is not None:
                        row["wer"] = wer(normalize_text(lyrics), hyp)
                row["ok"] = True
            except Exception as exc:  # noqa: BLE001 - un fallo no aborta la batería
                row["error"] = str(exc)[:300]
                print(f"  FALLÓ: {row['error']}", file=sys.stderr)
            rows.append(row)
            with (out / "results_deapi.csv").open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)

    ok = [r for r in rows if r["ok"]]
    spent = sum(float(r["price_credits"] or 0) for r in rows)
    print(f"\n{len(ok)}/{len(rows)} correctas. Gasto real: {spent:.4f} créditos. Resultados: {out}/results_deapi.csv")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
