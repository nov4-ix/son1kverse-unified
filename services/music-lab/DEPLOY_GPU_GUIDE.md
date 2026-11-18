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

## Google Colab

`scripts/colab_run.sh` instala las dependencias, levanta uvicorn en `:8002` y
publica un túnel `*.trycloudflare.com`. Úsalo solo para pruebas: no hay
autenticación de red más allá de `MUSIC_LAB_API_KEY`.

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
