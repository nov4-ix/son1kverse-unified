# Music Lab

Servicio FastAPI de generación de audio **CPU-first** para SON1KVERSE.
No usa APIs externas de generación.

## Modos

| `MUSIC_LAB_MODE` | Motor | Requisitos |
|---|---|---|
| `simulation` (default) | Síntesis determinista numpy | Ninguno (CPU) |
| `ace-step` | ACE-Step 1.5 | CUDA + pesos + librería |
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
