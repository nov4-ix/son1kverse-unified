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
- `/home/openclaw/genome2/son1kverse-unified/apps/api/audio_engine` — implementación local de referencia del motor anterior (referencia histórica; retirada en §8).

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
- Cualquier proveedor externo de generación musical: eliminado del
  monorepo. El Music Lab sólo habla con adaptadores locales.

### 6.3. Decisiones conservadoras

- **CPU por defecto**: `MUSIC_LAB_MODE=simulation` y las dependencias base no
  incluyen torch, transformers, ACE-Step ni el motor anterior.
- **ACE-Step 1.5**: API verificada contra el repo oficial
  `ace-step/ACE-Step-1.5` (paquete `acestep` 1.5.0):
  `AceStepHandler.initialize_service()` descarga los checkpoints de
  `ACE-Step/Ace-Step1.5` y `acestep.inference.generate_music()` genera el audio.
  El adaptador soporta `generate`, `repaint` y `cover`; `stems` responde 501
  porque el pipeline no expone separación drums/bass/other. El modo DiT-only
  (`ACE_STEP_USE_LM=false`) no requiere `nano-vllm`.
- **Motor anterior**: sólo `generate`; su pipeline se leyó desde
  `apps/api/audio_engine`. `repaint`, `cover` y `stems` respondían 501.
  `health()` exigía torch, su librería, pesos y CUDA (si el device era CUDA).
  Retirado en §8 por consumo de VRAM.
- **Selección de motor**: `simulation` o `ace-step`, sin modo `auto` ni
  fallback silencioso. Si el motor solicitado no está listo, el job falla con
  `ENGINE_UNAVAILABLE`. Nunca se usa un proveedor externo.
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
| `packages/shared-ui` (`@son1k/shared-ui`) | Paquete nuevo. Iconos oficiales SVG (`PlatformLogo`, `AlvaeSymbol`) y perilla literaria táctil. Sin proveedores externos ni Supabase. |
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

- Cualquier cliente de proveedores externos o de Supabase.
- Chatbot flotante de Pixel. Pixel queda como barra nerviosa en el borde izquierdo.
- Copia literal de las apps Next/Vite de `son1kvers3` (dependencias rotas, emojis, 6 perillas, voice cloning). Se reimplementó el contrato de UI del lore: 4 perillas + quinto acorde.

### 7.3. Decisiones de diseño

- Dualidad estricta de símbolos: triángulo+ojo = plataforma; círculo abierto+rayo = ALVAE.
- El proxy de Vite apunta a `http://localhost:3001` para `/api`, `/music` y `/health`. El cliente usa las rutas reales prefijadas `/api/v1/...`.
- Ghost Studio no inventa audio: el `source_audio_path` sale de `result.audio_path` del último job `succeeded`.
- Nova Post Pilot no llama a un CRUD inexistente: registra lanzamientos locales sobre el WAV real del job.
- Si el usuario no tiene fila `AlvaeAccount`, la credencial lo declara (`sin credencial`) en lugar de fabricar un tier.

## 8. Hardening v1 — rama `fix/hardening-v1`

Esta sección cierra los pendientes de §5 y documenta el estado real de la rama.
No reescribe el historial de §1–§7.

> Nota de §5: `passwordHash`, la fuente de verdad de `stripeCustomerId` y las
> migraciones versionadas quedaron resueltos aquí. La personalidad de Pixel de
> §3.8 vive ahora en `packages/shared-types/src/pixel.ts`.

### 8.1 Autenticación, propiedad y cuotas

- JWT obligatorio en `/api/v1/*` salvo `/auth/register`, `/auth/login`,
  `/health` y `/music/health`. `ALLOW_ANON_DEV` solo aplica en desarrollo y se
  ignora con `NODE_ENV=production`.
- Registro/login con rate limit de 10 peticiones por minuto.
- Propiedad verificada en perfiles, memoria, artefactos, feedback y jobs. Un
  job de Music Lab se resuelve contra `Generation.externalJobId`; no se acepta
  un `jobId` ajeno aunque el cliente lo conozca.
- Cuotas atómicas con `UPDATE ... WHERE generationsUsedThisMonth < limit` y
  `ADMIN_UNLIMITED` configurable. La cuota se devuelve si el job falla.
- Contraseñas scrypt con formato `salt:hash` en una única columna
  `User.passwordHash`.
- Los errores de validación conservan `details` y el contrato
  `{ success: false, error: { code, message, details? } }` en todo el scope
  raíz de Fastify.

### 8.2 Arranque reproducible

- Puertos únicos: API `3001`, Music Lab `8002`, Web `5173`.
  `MUSIC_LAB_URL` apunta por defecto a `http://127.0.0.1:8002`, el proxy de
  Vite y `colab_run.sh` usan los mismos valores.
- `Makefile` con `setup`, `up`, `dev`, `db-migrate`, `db-status`, `db-up`,
  `db-down`, `lab-test`, `test`, `typecheck` y `build`. `make setup` no
  sobrescribe `apps/api/.env` y genera un `JWT_SECRET` aleatorio.
- `pnpm typecheck` ejecuta `prisma generate` y `tsc --noEmit` en todo el
  workspace.

### 8.3 Motor único de audio

- Se eliminaron `apps/api/audio_engine/`, `Dockerfile.audio-engine`,
  `docker-compose.audio-engine.yml`, `AudioEngineClient`, los scripts de
  despliegue GPU legacy y las variables de entorno del motor anterior.
- `Pixel.orchestrate` y `Pixel.orchestrateCoherentSong` hablan solo con
  `musicLabClient`. La canción coherente es single-shot: letra estructurada +
  style tags → un job → un WAV. Se eliminó el job store en memoria y
  `/coherent-status`.
- ACE-Step es el único motor GPU. El motor anterior se retiró (adapter,
  configuración y enum de API) por su consumo de VRAM, y después se eliminó el
  modo `auto` y el fallback a simulación: sólo quedan `simulation` y
  `ace-step`. Los checkpoints fine-tuneados se montan por configuración, según
  `services/music-lab/DEPLOY_GPU_GUIDE.md`.
- Se eliminaron las rutas `/audio/*`. La descarga de audio de Pixel usa
  `GET /api/v1/artifacts/:artifactId/audio`, con verificación de dueño y ruta
  confinada a `output/tracks/`.
- `POST /api/v1/sessions`, `GET /api/v1/sessions/:id` y
  `POST /api/v1/sessions/:id/close` crean, consultan y cierran sesiones con el
  `userId` del JWT y ownership del perfil. `/orchestrate*` exige que la sesión
  exista, pertenezca al usuario y al perfil, y esté activa.
- La personalidad de Pixel vive en `packages/shared-types/src/pixel.ts` y la
  consumen API y Web; se borraron las copias duplicadas.
- La simulación CPU de Music Lab ejecuta síntesis y escritura en
  `asyncio.to_thread`, para no bloquear el event loop mientras atiende el
  polling de jobs largos. El cliente de la API usa un timeout de polling de al
  menos 60 s por petición, independiente del timeout de espera total.
- `JobManager` de Music Lab aplica TTL configurable (24 h por defecto), tope de
  jobs y limpieza periódica. Al expirar, borra el audio solo si está dentro de
  `MUSIC_LAB_OUTPUT_DIR`.
- La API usa `pino` en lugar de `console.*` (el único `console.error` restante
  es el fallo de configuración previo al logger).
- El despliegue GPU está documentado en
  `services/music-lab/DEPLOY_GPU_GUIDE.md`.

### 8.4 Datos y migraciones

- Migraciones versionadas: `20261117000000_init` y
  `20261118000000_user_password_hash`.
- `User.password` se renombró a `passwordHash`; el duplicado nullable de
  SSV-BETA nunca se escribió y se eliminó.
- `stripeCustomerId` queda solo en `User`; se eliminó de `AlvaeAccount`.
- `AlvaeAccount`, `AlvaeRole` y `AlvaeTier` quedan marcados como LEGACY: se
  conservan por compatibilidad, pero no gobiernan autorización ni facturación.
- Los campos JSON siguen como `String` (decisión de §3.5; no se tocó en esta
  rama).
- El reset local sobre PostgreSQL 16 aplicó ambas migraciones; `migrate status`
  quedó limpio y `migrate diff --from-migrations` devolvió
  “No difference detected”. El esquema resultante tiene `passwordHash` como
  única credencial y `generationsLimit` con default 3.
- `--shadow-database-url` debe apuntar a una base desechable, nunca a la base
  principal: Prisma la reinicia durante el diff y puede borrar
  `_prisma_migrations`. Si eso ocurre, se recupera el historial con
  `prisma migrate resolve --applied <migración>` sin tocar los datos.

### 8.5 CI e infraestructura local

- `.github/workflows/ci.yml` define dos jobs:
  - TypeScript: PostgreSQL 16, `prisma migrate deploy`, `typecheck`, `lint`,
    tests de API y build de Web.
  - Music Lab: Python 3.11 con `requirements.txt` y `pytest`.
- `docker-compose.yml` levanta PostgreSQL 16 para desarrollo con volumen y
  healthcheck. Las credenciales coinciden con `.env.example` y no son de
  producción.
- `apps/api/scripts/e2e-audio.mjs` prueba el flujo real en simulación:
  registro → login → `/music/generate` → polling → descarga del WAV.
- `apps/api/scripts/create-admin.ts` crea o promueve un ADMIN idempotente por
  email, con `role=ADMIN`, tier `ENTERPRISE`, generaciones ilimitadas y
  `storageLimit` máximo. Se ejecuta con `make admin-create`.

### 8.6 Bootstrap de ADMIN

- `make admin-create` lee `ADMIN_EMAIL`, `ADMIN_ALIAS` y `ADMIN_PASSWORD`
  (mínimo 12 caracteres), carga `apps/api/.env`, hashea con scrypt y hace
  `upsert` por email.
- La cuenta resultante tiene `role=ADMIN`, `subscriptionTier=ENTERPRISE`,
  `generationsLimit=UNLIMITED_GENERATIONS`, `storageLimit` máximo de
  ENTERPRISE, email verificado y cuenta activa.
- `QuotaService` omite el bloqueo de cuota para ADMIN cuando
  `ADMIN_UNLIMITED=true`; el uso mensual se sigue incrementando.
- Verificado en local: login correcto, `/auth/me` con límite 2147483647 y 4
  generaciones consecutivas en `simulation` sin bloqueo. La cuenta de prueba se
  dejó limpia (sin perfil ni generaciones) y con el contador en 0.

### 8.7 Verificación real

Ejecutado en el host de la rama:

- `pnpm typecheck`: OK.
- `pnpm --filter @son1k/api lint`: OK, sin errores ni warnings.
- `pnpm --filter @son1k/api test`: 6 archivos, 31 tests aprobados.
- `services/music-lab`: `pytest -q`, 21 tests aprobados.
- `prisma migrate deploy` sobre PostgreSQL 16 temporal: ambas migraciones
  aplicadas.
- `e2e-audio.mjs` contra API + Music Lab en `simulation`: job `succeeded`,
  WAV de ~2.0 MB y masterización a −14.02 LUFS.
- `POST /orchestrate-coherent` con proveedor LLM local simulado + Music Lab en
  `simulation`: artefacto `audio_url`, descarga autenticada 200 y 401 sin
  token.
- Flujo de sesiones contra PostgreSQL real: `POST /sessions`, luego
  `POST /orchestrate-coherent` con esa sesión, descarga 200 (WAV PCM 44.1 kHz),
  `close` y `status=completed`; orquestar después devuelve 409
  `SESSION_NOT_ACTIVE` y un usuario ajeno recibe 403 al crear o consultar la
  sesión.
- `POST /orchestrate-coherent` sin letra responde 400 `VALIDATION_ERROR`
  (antes era un 500 genérico).
- Smoke test de ADMIN `Nov4-ix`: login, `/auth/me`, perfil, 4 generaciones
  `simulation` (WAV PCM 16 bit 44.1 kHz), sesión, `orchestrate-coherent`
  (artefacto `audio_url`, WAV de 31.7 MB), cierre de sesión y 409
  `SESSION_NOT_ACTIVE` al reutilizarla.
- Se corrigió el bloqueo del event loop de `simulation` con
  `asyncio.to_thread`; el job coherente de 180 s terminó en ~10 s y el polling
  dejó de agotar el timeout de 15 s.
- `/v1/capabilities` expone solo `simulation` y `ace-step`; un `engine`
  retirado se rechaza con 400 en la API y 422 en Music Lab.
- `make -n` de todos los targets validado con una copia local de GNU Make
  (`make` no estaba instalado en el host).

No ejecutado:

- `docker compose up` y `docker build`: Docker no está instalado en el host de
  verificación.
- Motor ACE-Step real: requiere GPU y pesos; solo se verificó `simulation`.
- Comportamiento real en T4 (NaN/silencio, calidad de audio y tiempos de
  inferencia con `ACE_STEP_DTYPE=bfloat16`): queda pendiente de validación del
  usuario en Kaggle. Los tests añadidos usan fakes y no sustituyen esa prueba.
- GitHub Actions: el YAML no se ejecutó desde este entorno; queda para el
  primer push a GitHub.
