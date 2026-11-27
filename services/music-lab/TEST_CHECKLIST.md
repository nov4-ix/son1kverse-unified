# Checklist de pruebas GPU — Music Lab

Hechos medidos en Kaggle T4 (no reinterpretar):

- `float16` produce latentes NaN en T4.
- Forzando `bfloat16` en `acestep.gpu_config.cuda_supports_bfloat16` y
  `acestep.core.generation.handler.memory_utils.cuda_supports_bfloat16`:
  **7/7 generaciones OK**.
- Con `ACE_STEP_OFFLOAD=true`, 30 s y 180 s generados; VRAM pico ~5.5 GB;
  difusión ~33 s para 180 s.
- En T4 usa `ACE_STEP_DTYPE=bfloat16`. **No uses `float16` en T4.**

## 1. Preflight

- [ ] `python3 --version` (3.11–3.13; en 3.13 instalar acestep con
      `--ignore-requires-python`).
- [ ] `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader`.
- [ ] `MUSIC_LAB_API_KEY` definida; ningún endpoint/túnel público sin key.
- [ ] Secretos solo por variables de entorno; nada de claves en el repo.
- [ ] Volumen de modelos montado en `ACE_STEP_MODEL_PATH` (los pesos no se
      hornean en la imagen).

## 2. Dependencias

- [ ] `pip check` sin conflictos.
- [ ] `torch`, `torchvision` y `torchaudio` forman un set que coincide:
      `2.10.0 / 0.25.0 / 2.10.0` (default) o `2.11.0 / 0.26.0 / 2.11.0`.
- [ ] `requirements-gpu.txt` no contiene `heartlib`, `torchtune`, `torchao`
      ni `bitsandbytes`.
- [ ] `python -c "import acestep; from acestep.handler import AceStepHandler"`
      funciona.
- [ ] Si `ACE_STEP_QUANTIZATION` está definido, `torchao` está instalado
      aparte (no viene por defecto).

## 3. Arranque y salud

- [ ] `GET /health` responde `200` y `status=ok`.
- [ ] `engine.details` incluye `config_path`, `dtype`, `effective_dtype`,
      `quantization`, `offload`, `use_lm` y `gpu` (`name`, `vram_total_mb`,
      `vram_total_gb`).
- [ ] Los logs muestran `[ace_step] dtype forzado: bfloat16` en T4.
- [ ] `GET /v1/capabilities` responde y lista `generate`, `repaint`, `cover`
      (stems solo si el motor lo soporta).

## 4. Generación real

- [ ] `POST /v1/generate` con `duration_s=30` termina en `succeeded`.
- [ ] Repetir con `duration_s=180` y `ACE_STEP_OFFLOAD=true`.
- [ ] `metadata` incluye `dtype`, `steps`, `guidance`, `seed` y
      `quality_preset`.
- [ ] `quality_preset=turbo` funciona con el checkpoint turbo.
- [ ] Un preset incompatible responde `422` antes de encolar (no falla a mitad
      de la generación).
- [ ] `metadata.compute` incluye `phase_seconds.diffusion`,
      `phase_seconds.decode`, `phase_seconds.mastering` y
      `gpu_seconds_by_phase` cuando hay GPU.
- [ ] El WAV descargado no contiene NaN/clipping extremo; escuchar una muestra.
- [ ] `master=true` produce `metadata.mastering` y un archivo `-mastered`.

## 5. Seguridad y límites

- [ ] Sin `x-api-key` las rutas `/v1/*` responden `401`.
- [ ] TLS terminado en el proxy/túnel; no exponer uvicorn en claro a Internet.
- [ ] Límite de tamaño de request y timeout de job definidos en el proxy.
- [ ] `MUSIC_LAB_MAX_CONCURRENCY=1` en GPUs de 16 GB.

## 6. Cierre

- [ ] `pytest -q` en verde.
- [ ] `ruff check app tests` en verde.
- [ ] Reportar qué no se pudo verificar sin GPU (p. ej. VRAM real, latencia,
      calidad auditiva).
