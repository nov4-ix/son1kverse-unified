# Costos de generación — The Generator (ACE-Step 1.5)

Estado: **borrador con datos parciales**. Todo número marcado `PENDIENTE` debe
llenarse con mediciones reales (`scripts/ab_quality.py` → `results.csv`,
columna `gpu_seconds` y `wall_s`). No se publica ningún precio de tier hasta
que esta tabla esté completa.

## Fórmula

```
costo_por_cancion = (segundos_GPU_facturados / 3600) * precio_hora_GPU * (1 + overhead)
```

`segundos_GPU_facturados` = `wall_s` medido por canción en serverless (incluye
carga de pesos si hay arranque en frío) o `gpu_seconds` en un pod ya caliente.
`overhead` cubre: arranque en frío repartido, reintentos fallidos, almacenamiento
(R2/volumen), egress y margen de error. Hasta medirlo, usar 0.30 (PENDIENTE de validar).

Costo mensual de un pod 24/7 = `precio_hora * 730`. Solo conviene sobre serverless
cuando el uso sostenido supera aproximadamente `730 * precio_hora / costo_por_cancion`
canciones al mes (calcularlo con los números reales).

## Único dato medido hasta hoy

| GPU | Preset | Canción | Difusión | Offload | Encoder | VRAM pico | Fuente |
|---|---|---|---|---|---|---|---|
| T4 16 GB (Kaggle), bf16 forzado, offload, DiT-only | turbo (8 pasos) | 180 s | 32.9 s | ~10 s | 1.2 s | 5.5 GB antes del decode | prueba manual Kaggle |

Falta el tiempo total por canción completa (decode + mastering) y las pruebas de
3-4 minutos con letra: salen de `ab_quality.py`.

## Tabla a llenar (por canción de 180 s, preset turbo salvo indicación)

| GPU | Precio/h (verificar en runpod.io/pricing) | wall_s | gpu_seconds | Costo/canción | Canciones/h | Notas |
|---|---|---|---|---|---|---|
| T4 / L4 | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | |
| RTX 4090 24 GB | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | cabe xl_turbo |
| A100 40/80 GB | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | |
| 4090, preset xl_turbo | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | requiere >= 20 GB |
| 4090, preset turbo_lm | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | LM 1.7B suma tiempo |

Fuera de la GPU: R2 y volumen de pesos (precio/GB-mes PENDIENTE de confirmar con la
cotización vigente) y la alternativa de API alojado (p. ej. deAPI.ai, precio por
generación PENDIENTE de cotizar) para comparar contra serverless propio mientras
haya pocos usuarios.

## Cómo medir

1. Levantar Music Lab con el modelo del preset (`ACE_STEP_CONFIG_PATH`).
2. `python scripts/ab_quality.py --url <url> --api-key $MUSIC_LAB_API_KEY --presets turbo --duration 180 --master`
3. Repetir por GPU/preset. Cada ejecución deja `results.csv` y los audios.
4. Pegar medianas (no el mejor caso) en la tabla. Incluir una corrida en frío.

## Propuestas para los tiers (NO implementadas, a decidir con la tabla llena)

**Tope de uso razonable en ENTERPRISE.** Hoy `UNLIMITED_GENERATIONS` en
`packages/shared-types/src/subscription.ts` equivale a "sin límite". Con GPU real
cada canción cuesta dinero: un solo usuario abusivo puede dejar el plan en pérdida.
Sustituirlo por un tope mensual alto pero finito (valor a fijar con el costo por
canción y el precio del plan) más límite de concurrencia por usuario.

**Dos contadores de cuota.** Separar "generación estándar" (turbo) de "generación
calidad máxima" (xl_turbo / turbo_lm / sft), porque su costo de GPU difiere. Cada
tier tendría un cupo para cada una. Inspirado en `LimitsService` de SSV-BETA
(modelo 3.5 vs 5). Requiere `quality_preset` en la cuota (`QuotaService`).

**Regla de precio.** `precio_tier >= costo_por_cancion * canciones_incluidas * (1 + margen)`,
con el margen definido por el negocio y asumiendo uso del 100 % del cupo en el
peor caso. El tier FREE (3 generaciones) es costo de adquisición: calcular su
costo mensual total con N usuarios esperados antes del lanzamiento.

## Referencia de mercado

Boppy (ACE-Step 1.5 XL Turbo) ofrece uso gratis con anuncios y Premium móvil de
US$ 5.99/mes. Es el precio que el usuario tendrá en mente; el valor propio de
SON1KVERSE debe venir de masterizado a -14 LUFS, HAM, letras estructuradas y control
de BPM/tonalidad.
