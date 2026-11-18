# Music Lab

Servicio FastAPI de generación de audio **CPU-first** para SON1KVERSE.
No usa APIs externas de generación.

## Modos

| `MUSIC_LAB_MODE` | Motor | Requisitos |
|---|---|---|
| `simulation` (default) | Síntesis determinista numpy | Ninguno (CPU) |
| `ace-step` | ACE-Step 1.5 | CUDA + `acestep` + pesos |
| `heartmula` | HeartMuLa + HeartCodec | CUDA + pesos + `heartlib` |
| `auto` | ACE-Step → HeartMuLa → error | GPU disponible |

`auto` nunca cae a simulation salvo `MUSIC_LAB_ALLOW_SIM_FALLBACK=true`.

## Desarrollo (CPU)

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt ruff
.venv/bin/uvicorn app.main:app --reload --port 8002
```

Copia `.env.example` a `.env` si necesitas cambiar valores. En `simulation`
no hace falta API key; si defines `MUSIC_LAB_API_KEY`, todas las rutas `/v1/*`
exigen el header `x-api-key`.

## ACE-Step 1.5 (GPU)

El paquete oficial vive en GitHub (`acestep`, versión 1.5.0); el paquete
`ace-step` de PyPI sigue siendo la v1. ACE-Step pinea su propio torch y
vendoriza `nano-vllm`, por eso se instala sin dependencias:

```bash
pip install -r requirements.txt -r requirements-gpu.txt
pip install --no-deps -r requirements-ace-step.txt
export ACE_STEP_MODEL_PATH=/models/ace-step
MUSIC_LAB_MODE=ace-step uvicorn app.main:app --host 0.0.0.0 --port 8002
```

Con `ACE_STEP_AUTO_DOWNLOAD=true` los checkpoints se descargan de
`ACE-Step/Ace-Step1.5` en Hugging Face la primera vez. El adapter usa
`AceStepHandler.initialize_service` + `acestep.inference.generate_music` y
mapea `prompt`, `lyrics`, `duration_s`, `bpm`, `key`, `seed` y `style_tags`.
`ACE_STEP_USE_LM=false` (default) ejecuta solo el DiT; no requiere `nano-vllm`.

En Google Colab: `bash scripts/colab_run.sh` instala todo, levanta el servicio
en `:8002` y publica una URL `https://*.trycloudflare.com` sin cuenta ni token.

## API

- `POST /v1/generate` · `POST /v1/repaint` · `POST /v1/cover` · `POST /v1/stems`
  responden `202 {job_id, status, status_url}`.
- `GET /v1/jobs/{job_id}` · `GET /v1/jobs/{job_id}/audio`
- `GET /health` · `GET /v1/capabilities`
- OpenAPI: el spec exportado vive en `openapi.json` (`make lab-openapi`).

## Tests

```bash
.venv/bin/pytest -q
```
