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

## Datos medidos (Kaggle T4 16 GB, bf16 desde el repo, offload, DiT-only, turbo 8 pasos, 180 s, con mastering)

Corrida del 25-nov-2026, `scripts/ab_quality.py`, 5 canciones, parche bf16 aplicado por el adaptador
(dtype efectivo confirmado: bfloat16, sin NaN).

| Prueba | wall_s | gpu_seconds | Difusión | Decode | Mastering (CPU) | VRAM pico | LUFS |
|---|---|---|---|---|---|---|---|
| reggaeton_oscuro (1ª, arranque en frío) | 174.7 | 78.5 | 25.7 | 30.7 | 6.6 | 5.93 GB | -14.17 |
| lofi_instrumental | 93.5 | 85.7 | 29.0 | 39.0 | 6.6 | 6.07 GB | -14.61 |
| synthwave_cyberpunk | 96.8 | 87.2 | 31.8 | 37.3 | 6.5 | 6.07 GB | -14.24 |
| balada_guitarra_voz | 96.5 | 88.5 | 33.4 | 36.9 | 6.6 | 6.10 GB | -13.26 |
| trap_latino | 96.5 | 88.6 | 33.6 | 36.8 | 6.4 | 6.10 GB | -13.51 |

Lectura: en caliente una canción de 3 min tarda ~95 s de pared en T4 (el pico de 174.7 s de la primera
incluye ~80 s de carga de pesos y calentamiento). Con offload, el decode del VAE (~37 s) pesa más que la
difusión (~30 s). VRAM pico ~6 GB: cabe holgado en 16 GB. El mastering a -14 LUFS queda dentro de ±0.7 LU.
En T4 el cuello de botella es el decode; en GPUs más rápidas y sin offload se espera menos, PENDIENTE medir.

### Costo por canción en T4 (aritmética sobre lo medido, sin precios asumidos)

`costo = 96.5 s / 3600 * precio_hora = 0.0268 * precio_hora` (USD por canción, por cada USD/h de la GPU).
Con overhead de 0.30: `0.0348 * precio_hora`. Ejemplo: una GPU de USD 0.40/h daría ~USD 0.014 por canción.
El precio por hora es un dato a verificar en el proveedor; no está confirmado aquí.

## Tabla a llenar (por canción de 180 s, preset turbo salvo indicación)

| GPU | Precio/h (verificar en runpod.io/pricing) | wall_s | gpu_seconds | Costo/canción | Canciones/h | Notas |
|---|---|---|---|---|---|---|
| T4 | PENDIENTE | 96.5 (medido) | 88 (medido) | 0.0268 x precio/h | ~37 | medido en Kaggle |
| L4 | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | |
| RTX 4090 24 GB | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | cabe xl_turbo |
| A100 40/80 GB | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | |
| 4090, preset xl_turbo | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | requiere >= 20 GB |
| 4090, preset turbo_lm | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | LM 1.7B suma tiempo |

Fuera de la GPU: R2 y volumen de pesos (precio/GB-mes PENDIENTE de confirmar con la
cotización vigente) y la alternativa de API alojado (p. ej. deAPI.ai, precio por
generación PENDIENTE de cotizar) para comparar contra serverless propio mientras
haya pocos usuarios.

## Precios consultados (25-nov-2026) y costo por canción de 3 min

Fuentes: [runpod.io/pricing](https://www.runpod.io/pricing) (tarifas por hora; la página no separa flex/active ni
aclara Community vs Secure en pods) y [docs.runpod.io/serverless/pricing](https://docs.runpod.io/serverless/pricing.md)
(reglas de facturación). deAPI: artículo del propio proveedor,
[dev.to/deapi](https://dev.to/deapi/how-to-generate-ai-music-with-ace-step-api-cheaper-than-suno-5f38), con precios
tomados de su API el 18-jun-2026 (fuente del vendedor y con 5 meses de antigüedad: **cotizar de nuevo** con
`POST /api/v2/audio/music/price` antes de decidir).

Reglas de facturación RunPod serverless: se factura por segundo desde que el worker arranca hasta que se detiene
(incluye el arranque en frío = carga de modelo, y 5 s de espera tras el último job por defecto); un worker "Idle" no se
factura; volumen de red 0.07 USD/GB-mes (<1 TB); disco de contenedor ~0.10 USD/GB-mes.

Cálculo con el tiempo **medido en T4** (96.5 s por canción de 3 min). Es una **cota superior estimada** para GPUs más
rápidas que la T4 (A4000/L4/4090); el tiempo real en cada una está PENDIENTE de medir con `ab_quality.py`.

| Opción | Precio | Costo/canción (96.5 s) | Con overhead 30 % | Costo fijo/mes si 24/7 |
|---|---|---|---|---|
| RunPod serverless, grupo 16 GB (A4000...) | 0.58 USD/h | 0.0156 | 0.0202 | no aplica (escala a cero) |
| RunPod serverless, grupo 24 GB (L4, A5000, 3090) | 0.75 USD/h | 0.0201 | 0.0261 | no aplica |
| RunPod serverless, 4090 | 1.34 USD/h | 0.0359 | 0.0467 | no aplica |
| Pod A5000 24 GB | 0.27 USD/h | 0.0072 | 0.0094 | ~197 USD |
| Pod RTX 3090 | 0.50 USD/h | 0.0134 | 0.0174 | ~365 USD |
| Pod L4 | 0.69 USD/h | 0.0185 | 0.0241 | ~504 USD |
| Pod RTX 4090 | 0.89 USD/h | 0.0239 | 0.0311 | ~650 USD |
| deAPI turbo, 3 min | 0.002 USD/canción (jun-2026) | 0.0020 | n/a | 0 |
| deAPI XL Turbo (INT8), 3 min | 0.0024 USD/canción (jun-2026) | 0.0024 | n/a | 0 |

Lectura: con los números publicados, el API alojado sale ~6-8 veces más barato por canción que serverless propio y no
tiene costo fijo ni arranque en frío que operar. Un pod 24/7 solo se amortiza con tráfico muy alto (el pod A5000 de
197 USD/mes equivale a ~100 000 canciones/mes de deAPI turbo). Contrapartida del API de terceros: dependencia del
proveedor y de su precio, sin control del pipeline (HAM/mastering se harían en un paso propio sobre el audio recibido),
sin LoRA propio y con datos de usuarios pasando por un tercero. El diseño de adaptadores del repo permite añadir
un motor "deapi" sin tocar la API.

Prueba barata recomendada antes de decidir: con los 5 USD de créditos gratis de deAPI correr las mismas 5 canciones en
turbo y en XL Turbo y comparar a oído y con Whisper contra lo generado en T4.

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
