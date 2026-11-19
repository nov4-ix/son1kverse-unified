# Despliegue GPU de Music Lab

Music Lab es el único motor de audio de SON1KVERSE. Esta guía cubre el
despliegue del servicio FastAPI (`services/music-lab`) en una GPU.

## Imagen Docker

El `Dockerfile.gpu` instala PyTorch CUDA y el runtime de ACE-Step, pero **no
incluye los pesos**: se montan en `/models` para reutilizarlos entre arranques.

```bash
cd services/music-lab
docker build -f Dockerfile.gpu -t son1kverse/music-lab:gpu .
docker run --gpus all \
  -p 8002:8002 \
  -e MUSIC_LAB_MODE=ace-step \
  -e ACE_STEP_MODEL_PATH=/models/ace-step \
  -e ACE_STEP_DEVICE=cuda \
  -e ACE_STEP_AUTO_DOWNLOAD=true \
  -e ACE_STEP_OFFLOAD=true \
  -e MUSIC_LAB_OUTPUT_DIR=/outputs \
  -e MUSIC_LAB_API_KEY="$MUSIC_LAB_API_KEY" \
  -v "$PWD/models:/models" \
  -v "$PWD/outputs:/outputs" \
  son1kverse/music-lab:gpu
```

Con Compose:

```bash
cd services/music-lab
MUSIC_LAB_API_KEY=... docker compose -f docker-compose.gpu.yml up --build
```

El servicio escucha en `:8002`. Health: `GET /health`; capacidades:
`GET /v1/capabilities`; trabajos: `POST /v1/generate`, `GET /v1/jobs/:id`,
`GET /v1/jobs/:id/audio`.

## RunPod

1. Crea un Pod GPU (RTX 4090 / A6000) con una plantilla CUDA + Docker.
2. Expón el puerto **8002** (HTTP).
3. Monta un volumen persistente de al menos 50 GB para `/models` y `/outputs`.
4. Construye la imagen descrita arriba o sube `son1kverse/music-lab:gpu` a un
   registro y úsala como imagen del Pod.
5. Configura `MUSIC_LAB_MODE=ace-step`, `ACE_STEP_MODEL_PATH=/models/ace-step`
   y `ACE_STEP_AUTO_DOWNLOAD=true` para la primera descarga de checkpoints.
6. Apunta el backend Node a la URL pública:

```bash
MUSIC_LAB_URL=https://<tu-pod>.proxy.runpod.net
MUSIC_LAB_API_KEY=<la-misma-clave-que-el-servicio>
```

## Modal

1. Publica la imagen `son1kverse/music-lab:gpu` en un registro accesible.
2. Crea una función Modal con GPU (`gpu="A10G"` o superior), la imagen anterior
   y `MUSIC_LAB_MODE=ace-step`.
3. Persiste `/models` en un Volume de Modal para no descargar ACE-Step en cada
   arranque.
4. Expón el puerto 8002 y usa la URL del webhook/túnel como `MUSIC_LAB_URL`.

## Fine-tuning de ACE-Step (roadmap)

El objetivo es adaptar ACE-Step al catálogo de SON1KVERSE sin cambiar el
contrato de Music Lab. El adapter ya acepta cualquier checkpoint compatible
montado en `ACE_STEP_MODEL_PATH`; no hay entrenamiento dentro del servicio.

1. Fine-tunear ACE-Step 1.5 fuera del servicio con el dataset propio.
2. Publicar el checkpoint con la estructura esperada
   (`acestep-v15-*/` + `vae/`) dentro de `/models/ace-step`.
3. Ajustar `ACE_STEP_CONFIG_PATH` al nombre del checkpoint fine-tuneado.
4. Poner `ACE_STEP_AUTO_DOWNLOAD=false` para no descargar el modelo base.
5. Verificar `GET /health` y `GET /v1/capabilities` antes de generar.

Estado actual: no existe endpoint de entrenamiento ni carga dinámica de LoRA.
El servicio solo consume checkpoints ya entrenados; añadir LoRA requerirá
actualizar `acestep` y el adapter de forma explícita.

## Google Colab

`scripts/colab_run.sh` instala las dependencias, levanta uvicorn en `:8002` y
publica un túnel `*.trycloudflare.com`. Úsalo solo para pruebas: no hay
autenticación de red más allá de `MUSIC_LAB_API_KEY`.

El notebook `notebooks/colab_t4_ace_step.ipynb` es la ruta recomendada para una
T4 (16 GB):

1. Activa GPU T4 en *Runtime → Change runtime type*.
2. Define `REPO_URL` en la primera celda si el repo no está en `/content`.
3. El notebook arranca `scripts/colab_run.sh` con
   `ACE_STEP_OFFLOAD=true`, `ACE_STEP_USE_LM=false` y `ACE_STEP_DEVICE=cuda`.
4. Copia la URL del túnel y úsala como `MUSIC_LAB_URL` en la API Node.

El DiT-only (`ACE_STEP_USE_LM=false`) es el modo que cabe con holgura en T4. El
LM 5Hz se puede activar con `ACE_STEP_USE_LM=true`, pero reduce margen de VRAM
y aumenta la latencia.

## Verificación

```bash
curl -s http://<host>:8002/health | jq
curl -s -H "x-api-key: $MUSIC_LAB_API_KEY" http://<host>:8002/v1/capabilities | jq
```

Desde el monorepo, el flujo completo en CPU (simulation) es:

```bash
make lab-dev
make lab-test
```

La API Node solo necesita `MUSIC_LAB_URL` y, si aplica, `MUSIC_LAB_API_KEY`.
El motor anterior (`apps/api/audio_engine`) fue retirado.

## Smoke test real

CI ejecuta el flujo E2E en `simulation` (sin GPU). Para validar ACE-Step real:

```bash
# Music Lab en la GPU/Colab con ACE_STEP_OFFLOAD=true y ACE_STEP_USE_LM=false
export MUSIC_LAB_URL="https://<tu-tunel>.trycloudflare.com"
export MUSIC_LAB_API_KEY="<clave>"
# API Node local con PostgreSQL migrado
E2E_ENGINE=ace-step E2E_DURATION_S=30 \
  node apps/api/scripts/e2e-audio.mjs
```

El script autentica, verifica `/music/health`, genera, hace polling, descarga el
WAV autenticado y exige `metadata.ham`; con `master=true`, también exige
`metadata.mastering`. El reporte incluye `metadata.compute` (`gpu_seconds`,
`peak_vram_bytes`) para estimar costos de RunPod/Modal.

Cada generación deja dos logs estructurados en la API Node:

- `generation.accepted`: job, usuario, tier, cuota consumida y límite.
- `generation.completed`: duración del audio, `gpu_seconds`, `peak_vram_bytes`,
  motor/modo y tiempo total de procesamiento.
