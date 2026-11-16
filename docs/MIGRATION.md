# Migración a `son1kverse-unified`

Rama: `feat/unify-backend`

Fuentes:
- `/home/openclaw/genome2/son1kverse-backend`
- `/home/openclaw/genome2/SSV-BETA`
- `/home/openclaw/genome2/ALFASSV`

Destino:
- `/home/openclaw/genome2/son1kverse-unified`

## 1. Origen → destino

| Origen | Destino | Tratamiento |
|---|---|---|
| `son1kverse-backend/src/**` | `apps/api/src/**` | Copia del backend, conservando la lógica y los nombres de dominio. |
| `son1kverse-backend/package.json` | `apps/api/package.json` | Renombrado a `@son1k/api`; ESM; dependencia `@son1k/db` como `workspace:*`. |
| `son1kverse-backend/tsconfig.json` | `apps/api/tsconfig.json` | Extiende `tsconfig.base.json`; `NodeNext`, `ES2022`, strict y `noUncheckedIndexedAccess`. |
| `son1kverse-backend/tests/**`, `scripts/**`, `vitest.config.ts` | `apps/api/**` | Copiados sin cambios. |
| `son1kverse-backend/prisma/schema.prisma` | `packages/db/prisma/schema.prisma` | Base del schema unificado. |
| `SSV-BETA/backend/prisma/schema.prisma` | `packages/db/prisma/schema.prisma` | Modelos y enums ALVAE, generación, tracks, proyectos, refresh tokens y analítica fusionados. |
| `ALFASSV/apps/web-classic/src/lib/pixelPersonality.ts` | `apps/api/src/core/pixel/pixelPersonality.ts` | Adaptado a ESM, TypeScript estricto y dirección creativa de orquestador. |
| `son1kverse-backend/src/storage/client.ts` | `apps/api/src/storage/client.ts` | `PrismaClient` se importa desde `@son1k/db`; ya no se instancia un cliente local. |
| `son1kverse-backend/src/config/index.ts` | `apps/api/src/config/index.ts` | Default PostgreSQL y carga opcional de `.env` sin depender de `--env-file`. |

No se copiaron:
- `.git/`, `node_modules/`, `dist/`, `.env`.
- `son1kverse-backend/prisma/` dentro de `apps/api`; `packages/db` es la única fuente de verdad del schema.
- `package-lock.json`; el monorepo usa pnpm.

## 2. Modelos y campos

| Modelo | Backend | SSV-BETA | Unificado |
|---|---|---|---|
| `User` | `id`, `email`, `alias`, `password`, `profile`, `sessions`, timestamps | `id`, `email`, `name`, `passwordHash`, `avatarUrl`, `role`, suscripción, cuotas, OAuth, relaciones | Ambos conjuntos. Los campos del backend siguen siendo obligatorios; los de SSV quedan opcionales para no romper el registro existente. |
| `ArtistProfile` | Identidad, géneros, BPM, estética, referencias, emociones, narrativa, branding | No existe | Se conserva el modelo del backend. |
| `Memory`, `Session`, `Artifact` | Memoria, sesiones y artefactos del backend | No existen | Se conservan. |
| `AlvaeAccount` | No existe | Roles, tier, símbolo, color, permisos, blindaje y Stripe | Se añade con relación 1:1 a `User`. |
| `RefreshToken` | No existe | Token, usuario, expiración | Se añade. |
| `Generation` | No existe | Prompt, parámetros, estado, modelo, seed, audio, track | Se añade. |
| `Track` | No existe | Audio, metadatos, estado, métricas, proyecto | Se añade. |
| `Project` | No existe | Nombre, portada, visibilidad, tracks | Se añade. |
| `ApiUsage` | No existe | Endpoint, método, estado, latencia | Se añade. |

Enums unificados:
- `UserRole`
- `SubscriptionTier`
- `AlvaeRole`
- `AlvaeTier`
- `GenerationStatus`
- `TrackStatus`

## 3. Conflictos y decisiones

### 3.1. `User` duplicado

El backend define `User` con `alias` y `password`; SSV-BETA define `User` con `name` y `passwordHash`. La fusión conserva ambos contratos:

- `alias` sigue siendo obligatorio y único.
- `password` sigue siendo obligatorio.
- `name`, `passwordHash`, `avatarUrl` y los campos de suscripción/uso quedan opcionales.
- `role` de SSV-BETA se conserva en `User`; `AlvaeAccount.role` es un rol distinto y no se reemplaza.

Consecuencia documentada: un usuario creado originalmente en SSV-BETA puede no tener `alias` ni `password`; un usuario del backend puede no tener `passwordHash`. No se inventó una migración de datos para backfill.

### 3.2. `stripeCustomerId` duplicado

SSV-BETA declara `stripeCustomerId` tanto en `User` como en `AlvaeAccount`. Se conservaron ambos campos tal como estaban, con sus restricciones `@unique`. No se eliminó ninguno porque no hay evidencia en las fuentes de cuál es la fuente de verdad. Queda como decisión pendiente de producto.

### 3.3. `SubscriptionTier` y `AlvaeTier`

Son enums diferentes y se conservaron por separado. `SubscriptionTier` describe el plan comercial; `AlvaeTier` describe el nivel dentro del sistema ALVAE. No se combinaron.

### 3.4. Créditos

SSV-BETA no contiene un modelo de créditos. Solo define cuotas en `User`:

- `generationsUsedThisMonth`
- `generationsLimit`
- `storageUsedBytes`
- `storageLimit`

No se creó un modelo `Credit` ni campos de saldo porque no existen en las fuentes.

### 3.5. SQLite → PostgreSQL

El schema del backend usaba SQLite y almacenaba JSON como `String`. El schema unificado usa PostgreSQL. Para no alterar la lógica de negocio en esta fase, los campos JSON siguen siendo `String`; la migración a `Json` nativo queda para una fase posterior. Los campos que ya usan `String[]`, `BigInt` y `@db.Text` son compatibles con PostgreSQL.

### 3.6. `prisma/` local del backend

No se copió `son1kverse-backend/prisma/` a `apps/api`. Todo el acceso a datos y el schema viven en `packages/db` para evitar dos fuentes de verdad.

### 3.7. Dependencia `@son1k/db`

`apps/api` importa `PrismaClient` desde `@son1k/db`. El paquete expone tipos desde `src/index.ts` y runtime desde `dist/index.js`. Por eso:

- `postinstall` ejecuta `prisma generate`.
- `predev` compila `@son1k/db` antes de arrancar la API.
- `pnpm build` construye los paquetes en orden topológico.

### 3.8. Personalidad de Pixel

La fuente de ALFASSV es un sistema de personalidad conversacional con emojis, frases aleatorias y respuestas de chatbot. La adaptación conserva:

- Núcleo de Pixel.
- Rasgos.
- Estados creativos.
- Vocabulario.
- Frases de firma como banco de voz, no como diálogo.

Se eliminaron:

- Emojis.
- Helpers aleatorios `getRandomMood`, `getRandomPhrase`, `getSignaturePhrase`.
- La instrucción de conversar con el usuario.

La personalidad ahora:

- Se selecciona de forma determinista con `selectPixelTone(intent)`.
- Se inyecta en el system prompt de cada agente mediante `buildPixelPersonalityPrompt`.
- Ajusta la temperatura de generación.
- Se registra en el evento `AGENT_SELECTED` como `personality`.
- No altera el routing de provider/modelo en esta fase. La decisión es conservadora para no cambiar coste, latencia ni comportamiento existente; queda documentada como evolución futura.

Mapeo de estados:

| Señal del intent | Estado |
|---|---|
| `rebellion`, `anger` | `rebellious` |
| `melancholy`, `nostalgia`, `longing`, `digital_solitude` | `poetic` |
| `hope`, `joy`, `euphoria`, `transcendence` | `motivational` |
| `urgency: high` | `rebellious` |
| Resto | `casual-technical` |

Temperaturas:

| Estado | Temperatura |
|---|---|
| `casual-technical` | 0.75 |
| `poetic` | 0.9 |
| `motivational` | 0.85 |
| `rebellious` | 0.95 |

## 4. Validación

Comandos ejecutados:

```bash
npx -y pnpm@9.15.9 install
npx -y pnpm@9.15.9 db:validate
npx -y pnpm@9.15.9 typecheck
npx -y pnpm@9.15.9 --filter @son1k/api test
npx -y pnpm@9.15.9 build
```

`typecheck` ejecuta `prisma generate` y después `pnpm -r exec tsc --noEmit`.

Resultados:

- `prisma validate`: schema válido.
- `typecheck`: sin errores en `apps/api`, `packages/db` y `packages/shared-types`.
- Tests: 4 archivos, 16 tests aprobados.
- `build`: 3 paquetes construidos; `@son1k/db` se compila antes de `@son1k/api`.
- `import('@son1k/db')` desde `apps/api`: `PrismaClient` disponible en runtime.
- `pnpm-lock.yaml` generado y versionado.

Limitación: Node activo `v26.13.1`; no hay Node 20 instalado en este entorno. El proyecto fija Node 20 en `.nvmrc` y `engines >=20.12`, y la validación se ejecutó con Node 26 y `pnpm 9.15.9` vía `npx`.

## 5. Pendientes fuera de la fase 1

- Decidir la fuente de verdad de `stripeCustomerId`.
- Decidir si `passwordHash` sustituye a `password`.
- Migrar campos JSON de `String` a `Json` nativo.
- Evaluar si la personalidad debe influir también en la selección de modelo.
- Añadir migraciones SQL versionadas de Prisma para PostgreSQL.

## 6. Music Lab (`services/music-lab`)

Rama: `feat/music-lab`

Fuentes de solo lectura:
- `/home/openclaw/genome2/son1k-heart` — HAM (Harmonic Alignment Module) y `post_processing/mastering_chain.py`.
- `/home/openclaw/genome2/son1kvers3/music-lab` — copia de referencia del pipeline musical.
- `/home/openclaw/genome2/son1kverse-unified/apps/api/audio_engine` — implementación local de referencia para la API de HeartMuLa.

### 6.1. Qué se portó

| Origen | Destino | Tratamiento |
|---|---|---|
| `alignment/key_detection.py`, `key_detection_v2.py` | `app/ham/key.py` | Detección de tonalidad por chroma FFT + perfiles mayor/menor. Se eliminó `librosa`. |
| `alignment/bpm_detection.py` | `app/ham/bpm.py` | Envolvente de onsets + autocorrelación FFT. Se eliminó `librosa.beat`. |
| `alignment/energy_profile.py` | `app/ham/energy.py` | RMS, normalización, fades, soft clip. |
| `alignment/spectral_match.py` | `app/ham/spectral.py` | Centroide/perfil espectral y ajuste por shelf FFT. |
| `alignment/stitcher.py` | `app/ham/stitcher.py` | Crossfade, concatenación, trim y padding. |
| `alignment/harmonic_alignment.py` | `app/ham/engine.py` | `HarmonicAligner` con análisis y alineación de energía/espectro. |
| `post_processing/mastering_chain.py` | `app/mastering/chain.py` | Normalización tipo LUFS, EQ ligera, limiter true-peak y fades. |

### 6.2. Qué se descartó

- `pyloudnorm`: la normalización LUFS se reimplementó con K-weighting aproximado
  (scipy) y gating por bloques. No es una certificación BS.1770; es una
  aproximación documentada y determinista.
- Compresor multibanda y stereo enhancer del MasteringChain original: no son
  necesarios para el contrato del Music Lab. Se conservan en la fuente.
- Pitch shift y time stretch de HAM: dependían de `librosa`. `HarmonicAligner`
  los detecta y reporta como warnings, pero no altera el audio.
- Detección de acordes y variantes v2 no esenciales: quedan fuera de este
  port para mantener el servicio liviano.
- `workers/`, Celery/Redis, cache middleware, voice cloning, remix y servicios
  de análisis del repo de origen: no forman parte del alcance del Music Lab.
- Cualquier proveedor externo de generación (incluido Suno): eliminado del
  monorepo. El Music Lab sólo habla con adaptadores locales.

### 6.3. Decisiones conservadoras

- **CPU por defecto**: `MUSIC_LAB_MODE=simulation` y las dependencias base no
  incluyen torch, transformers, ACE-Step ni HeartMuLa.
- **ACE-Step**: no se pudo verificar la API pública de inferencia en las fuentes
  locales. La carga/validación está lista, pero `_run_inference` lanza 501 con
  `code=ACE_STEP_API_UNVERIFIED` y `health()` mantiene `ready=false` hasta que
  `ACE_STEP_API_VERIFIED=true`. Ver `TODO(verify-api)`.
- **HeartMuLa**: sólo `generate`; se confirmó el uso de
  `heartlib.HeartMuLaGenPipeline` leyendo `apps/api/audio_engine`. `repaint`,
  `cover` y `stems` responden 501. `health()` exige torch, heartlib, pesos y
  CUDA/bitsandbytes (si el device es CUDA).
- **Auto**: ACE-Step → HeartMuLa → error explícito. Nunca usa un proveedor
  externo. Sólo cae a simulation con `MUSIC_LAB_ALLOW_SIM_FALLBACK=true`, y el
  resultado se marca con `mode=simulation`.
- **Rutas de audio**: `repaint`, `cover` y `stems` sólo aceptan archivos dentro
  de `MUSIC_LAB_OUTPUT_DIR` para evitar lecturas arbitrarias del filesystem.
- **Formato**: WAV y MP3 vía libsndfile. Si el build de libsndfile no trae MP3,
  el servicio responde 501 `OUTPUT_FORMAT_UNSUPPORTED`.
- **Jobs**: en memoria + cola asyncio + semáforo. No sobreviven a un reinicio;
  es una decisión explícita de esta fase.
- **IDs**: el adaptador crea el archivo con su propio UUID y el manager
  reemplaza `result.job_id` por el job público. La ruta del audio es la fuente
  de verdad, no el nombre del archivo.
- **Docker**: no se pudo ejecutar `docker build --check` en este entorno
  (Docker no está instalado). Los Dockerfiles quedan escritos y sujetos a
  validación en un host con Docker.

## 7. Fase 3 — Frontend unificado (`apps/web` + `packages/shared-ui`)

Rama: `feat/unified-ui`

Fuentes de solo lectura:
- `/home/openclaw/genome2/son1kvers3` (`apps/web-classic`, `apps/the-generator`, `apps/ghost-studio`, `apps/nova-post-pilot`, `packages/shared-ui`, `packages/shared-types`)
- Lore y contratos: `docs/DESIGN_LORE.md`, `services/music-lab/openapi.json`, `apps/api/src/api/routes/music.ts`

### 7.1. Qué se creó

| Destino | Tratamiento |
|---|---|
| `packages/shared-ui` (`@son1k/shared-ui`) | Paquete nuevo. Iconos oficiales SVG (`PlatformLogo`, `AlvaeSymbol`) y perilla literaria táctil. Sin Suno ni Supabase. |
| `apps/web` (`@son1k/web`) | App Vite + React 18 + Tailwind. Landing XentriX y consola ALVAE. |
| `apps/web/src/context/SystemModeContext.tsx` | Estado persistente `'xentrix' \| 'alvae'`, `Ctrl+Alt+H`, pulsación 1.5s y transición 1.2s. |
| `apps/web/src/lib/api.ts` | Cliente tipado contra `apps/api`: `POST /api/v1/music/generate` (ruta Fastify `/music/generate`), polling `queued → running → succeeded/failed`, WAV en `/api/v1/music/jobs/:id/audio`. |
| `apps/web/src/lib/pixelPersonality.ts` | Señales breves de Pixel (sin emojis, sin chatbot) alineadas a `apps/api/src/core/pixel/pixelPersonality.ts`. |
| `apps/web/src/views/GeneratorView.tsx` | La Terminal: prompt, duración/BPM/tonalidad, 4 perillas + Quinto Acorde. |
| `apps/web/src/views/GhostStudioView.tsx` | Onda con cicatrices doradas, `repaint` (`start_s`/`end_s`), `cover`, `stems`. |
| `apps/web/src/views/AlvaeProfileView.tsx` | Credencial ALVAE + Nova Post Pilot anclado al último job real. |
| `apps/api/src/api/routes/music.ts` | Se expusieron `POST /music/repaint`, `/music/cover` y `/music/stems` para Ghost Studio. |
| `apps/api/src/api/routes/auth.ts` | `GET /auth/me` para alias, cuotas y `AlvaeAccount` si existe. |
| `Makefile` | Target `web-dev`. |

### 7.2. Qué se descartó

- Cualquier cliente `suno` o `supabase`.
- Chatbot flotante de Pixel. Pixel queda como barra nerviosa en el borde izquierdo.
- Copia literal de las apps Next/Vite de `son1kvers3` (dependencias rotas, emojis, 6 perillas, voice cloning). Se reimplementó el contrato de UI del lore: 4 perillas + quinto acorde.

### 7.3. Decisiones de diseño

- Dualidad estricta de símbolos: triángulo+ojo = plataforma; círculo abierto+rayo = ALVAE.
- El proxy de Vite apunta a `http://localhost:3001` para `/api`, `/music` y `/health`. El cliente usa las rutas reales prefijadas `/api/v1/...`.
- Ghost Studio no inventa audio: el `source_audio_path` sale de `result.audio_path` del último job `succeeded`.
- Nova Post Pilot no llama a un CRUD inexistente: registra lanzamientos locales sobre el WAV real del job.
- Si el usuario no tiene fila `AlvaeAccount`, la credencial lo declara (`sin credencial`) en lugar de fabricar un tier.
