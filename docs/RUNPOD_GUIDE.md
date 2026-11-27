# Guía de despliegue en RunPod — Music Lab

Objetivo del beta: **The Generator** con ACE-Step 1.5 + HAM + MasteringChain.
Este documento compara las dos formas de usar RunPod y fija el checklist de
seguridad. No se recomienda un Pod 24/7 para el beta: el costo ocioso no está
justificado hasta tener demanda sostenida.

## Imagen

El `Dockerfile.gpu` ya cumple el contrato:

- Pesos **fuera de la imagen**: se montan en `/models` (volumen persistente).
- Healthcheck HTTP contra `/health`.
- Variables por entorno (`MUSIC_LAB_*`, `ACE_STEP_*`).
- Usuario no root, `MUSIC_LAB_MAX_CONCURRENCY=1` por defecto.

```bash
cd services/music-lab
docker build -f Dockerfile.gpu -t <registro>/son1k-music-lab:gpu .
docker push <registro>/son1k-music-lab:gpu
```

Variables mínimas:

```bash
MUSIC_LAB_MODE=ace-step
MUSIC_LAB_API_KEY=<secreto>
MUSIC_LAB_OUTPUT_DIR=/outputs
ACE_STEP_MODEL_PATH=/models/ace-step
ACE_STEP_DEVICE=cuda
ACE_STEP_DTYPE=bfloat16      # T4: nunca float16 (NaN medido)
ACE_STEP_OFFLOAD=true        # 16 GB
ACE_STEP_USE_LM=false        # DiT-only
ACE_STEP_CONFIG_PATH=acestep-v15-turbo
ACE_STEP_AUTO_DOWNLOAD=true  # solo la primera vez
```

## Opción A — Serverless (pago por segundo)

RunPod Serverless cobra por tiempo de ejecución del worker, no por el Pod
completo. Es la opción preferida para tráfico intermitente.

Dos variantes:

1. **Load Balancer / HTTP**: el worker arranca uvicorn y RunPod enruta HTTP.
   Es la integración natural con la API Node (`MUSIC_LAB_URL`).
2. **Queue-based worker**: requiere un handler que reciba el evento de RunPod.
   Implica adaptar el contrato actual; no es la ruta recomendada para el beta.

Puntos a medir/decidir antes de producción:

- **Cold start**: descarga de checkpoints y carga del modelo. Mitigación:
  volumen de red persistente para `/models` y worker mínimo caliente.
- **Timeout máximo** del endpoint frente a generaciones de 180 s.
- **Concurrencia**: 1 generación por GPU de 16 GB; no prometer paralelismo.
- **Escalado a cero**: si se apaga, el primer request paga el arranque.
- **Costo real por canción**: `gpu_seconds` medido, no estimado.

## Opción B — Pod bajo demanda

Pod con GPU, volumen persistente y puerto HTTP expuesto. Se enciende para
sesiones de prueba o campañas y se apaga al terminar.

Pasos:

1. Crea un Pod GPU (T4/L4/4090/A100 según presupuesto) con plantilla CUDA +
   Docker.
2. Monta un volumen persistente de ≥50 GB en `/models` y `/outputs`.
3. Usa la imagen publicada y las variables de la sección anterior.
4. Expón el puerto **8002** (RunPod genera una URL `*.proxy.runpod.net`).
5. Verifica `GET /health` y `GET /v1/capabilities`.
6. Configura la API Node:

```bash
MUSIC_LAB_URL=https://<pod>.proxy.runpod.net
MUSIC_LAB_API_KEY=<el mismo secreto>
```

7. Apaga el Pod al terminar. No lo dejes encendido “por si acaso”.

## Comparación

| Criterio | Serverless | Pod bajo demanda |
|---|---|---|
| Facturación | Por segundo de ejecución | Por hora encendido |
| Cold start | Sí (pesos + carga) | Sí al arrancar el Pod |
| Máximo control | Menor | Total (SSH, logs, GPU) |
| Ideal para | Beta con tráfico irregular | Pruebas, demos, campañas |
| Riesgo principal | Timeout/cold start | Costo ocioso si se olvida apagar |
| Recomendación beta | Sí, con volumen persistente | Sí, con apagado manual |

**No recomendado:** Pod 24/7 durante el beta. Si se necesita disponibilidad,
preferir serverless con mínimo caliente y medir el costo por canción.

## Seguridad (obligatorio)

- [ ] `MUSIC_LAB_API_KEY` definida; nunca vacía en un endpoint público.
- [ ] Ningún túnel o URL de RunPod sin API key.
- [ ] TLS terminado por RunPod/proxy; no exponer uvicorn en claro.
- [ ] Límite de tamaño de request en el proxy (p. ej. 1 MB; las letras son
      texto, no archivos).
- [ ] Timeout de job alineado con `duration_s` máximo y el timeout del proxy.
- [ ] `MUSIC_LAB_MAX_CONCURRENCY=1` en GPUs de 16 GB.
- [ ] Rate limit en el proxy/API Node además de la cuota de generaciones.
- [ ] Secretos solo por variables de entorno; no en la imagen ni en el repo.
- [ ] Volumen de modelos con permisos del usuario `musiclab` (uid 10001).
- [ ] Rotar la API key si se comparte una URL de prueba.
- [ ] Revisar logs sin volcar letras ni rutas privadas de usuarios.

## Smoke test

```bash
export MUSIC_LAB_URL="https://<host>"
export MUSIC_LAB_API_KEY="<secreto>"

curl -fsS "$MUSIC_LAB_URL/health" | jq
curl -fsS -H "x-api-key: $MUSIC_LAB_API_KEY" "$MUSIC_LAB_URL/v1/capabilities" | jq

curl -fsS -X POST "$MUSIC_LAB_URL/v1/generate" \
  -H "x-api-key: $MUSIC_LAB_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"dark reggaeton","duration_s":30,"bpm":92,"key":"Am","quality_preset":"turbo"}'
```

Luego consulta el job, descarga el WAV y confirma en `metadata`:
`dtype=bfloat16`, `steps`, `guidance`, `seed`, `quality_preset` y
`compute.phase_seconds` (diffusion/decode/mastering).

## Costos

La fórmula y la tabla de GPUs están en `COSTS.md`. No inventes precios: llena
`precio_hora_gpu` con la tarifa vigente de RunPod y `gpu_seconds` con las
mediciones reales de `/v1/jobs/{id}`.
