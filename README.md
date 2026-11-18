# SON1KVERS3 — Ecosistema Creativo Soberano (Genome 2.0)

> *"Lo imperfecto también es sagrado."* — **Ctrl+Alt= Humanity**

Monorepo unificado que consolida la arquitectura backend, el motor neuronal de síntesis musical propio y la interfaz dual **XentriX / ALVAE** inspirada en *"SON1KVERS3: La Vibración Prohibida"*.

## Arquitectura del Monorepo

- **`apps/web`** (`@son1k/web`): Frontend React 18 + Vite + Tailwind CSS con dualidad de modos (`Ctrl + Alt + H` / `ctrl+alt=Security` → `ctrl+ALT=humanity`), logotipo oficial SVG, simbología **ALVAE (`◯⚡`)**, **La Terminal** con **Pixel A&R Digital** autónomo, **4 Perillas Literarias + Quinto Acorde**, **Ghost Studio** y **El Santuario**.
- **`apps/api`** (`@son1k/api`): Backend Fastify + TypeScript ESM strict con orquestación de agentes (`MusicAgent`, `LyricsAgent`, `StrategyAgent`, `VisualAgent`), identidad de **Pixel** como sistema nervioso central y cliente tipado hacia Music Lab.
- **`packages/db`** (`@son1k/db`): Esquema PostgreSQL unificado en Prisma (`User`, `ArtistProfile`, `Memory`, `AlvaeAccount`, `Generation`, `Track`, `Project`).
- **`packages/shared-types`** (`@son1k/shared-types`): Planes, límites de generación/almacenamiento y personalidad de Pixel compartidos por API y Web.
- **`packages/shared-ui`** (`@son1k/shared-ui`): Componentes vectoriales oficiales (`PlatformLogo`, `AlvaeSymbol`) y controles táctiles (`LiteraryKnob`).
- **`services/music-lab`**: Microservicio Python 3.11–3.13 + FastAPI aislado para generación de audio soberana (sin dependencias de APIs de terceros):
  - **Motor neuronal:** **ACE-Step 1.5** (generación completa, *repainting* y *covers*), con soporte para checkpoints fine-tuneados. HeartMuLa fue descartado por su consumo de VRAM.
  - **DSP Propio:** **HAM** (*Harmonic Alignment Module*) y **`MasteringChain`** (-14 LUFS).
  - **Modo CPU (`simulation`):** Síntesis determinista en CPU para desarrollo local sin GPU y `Dockerfile.gpu` listo para despliegue Serverless GPU (RunPod / Modal).

## Requisitos

- Node.js >= 20.12 y pnpm 9.
- Python 3.11, 3.12 o 3.13 (`python3 -m venv`).
- PostgreSQL 14+ accesible en `DATABASE_URL`.
- `make`, `openssl` y `curl`.

## Arranque Rápido en Local

```bash
# 1. PostgreSQL debe estar corriendo y la base debe existir.
#    Si no tienes PostgreSQL local: make db-up (requiere Docker).
#    Ajusta DATABASE_URL en apps/api/.env si no usas los valores por defecto.

# 2. Instalar Node + Python, crear apps/api/.env y generar JWT_SECRET.
make setup

# 3. Aplicar migraciones Prisma.
make db-migrate

# 4. Levantar Music Lab (:8002), API (:3001) y Web (:5173) a la vez.
make dev
```

Si PostgreSQL ya está migrado, `make up` ejecuta `setup + db-migrate + dev` en un solo comando.

## Admin local para pruebas reales

El bootstrap crea o promueve una cuenta `ADMIN` con cuota de generaciones
ilimitada (`ADMIN_UNLIMITED=true`). La contraseña se pasa por entorno y nunca
se guarda en el repositorio:

```bash
ADMIN_EMAIL='nov4-ix@son1kverse.local' \
ADMIN_ALIAS='Nov4-ix' \
ADMIN_PASSWORD='<contraseña-de-12-o-más-caracteres>' \
make admin-create
```

El script es idempotente: si el email ya existe, actualiza rol, tier y límites.
Las cuentas `ADMIN` no se bloquean por cuota de generaciones; el contador de
uso sigue registrándose para auditoría.

`make setup` nunca sobrescribe un `apps/api/.env` existente. El JWT se exige en todas las rutas `/api/v1/*` salvo registro y login; `ALLOW_ANON_DEV=true` solo existe para pruebas locales y se ignora con `NODE_ENV=production`.

## Puertos

| Servicio | Puerto | Variable |
|---|---:|---|
| Web (Vite) | 5173 | `WEB_PORT` / `server.port` |
| API (Fastify) | 3001 | `PORT` |
| Music Lab (FastAPI) | 8002 | `MUSIC_LAB_PORT` / `PORT` |

El proxy de Vite usa `VITE_API_PROXY_TARGET` (default `http://localhost:3001`).

## Comandos Principales (`Makefile`)

- `make setup` — Instala dependencias Node y Python, crea `apps/api/.env` con un `JWT_SECRET` aleatorio.
- `make dev` — Levanta Music Lab, API y Web en paralelo; al salir detiene el laboratorio.
- `make up` — `setup + db-migrate + dev`.
- `make typecheck` — Validación estricta de TypeScript (`tsc --noEmit`) en todo el workspace.
- `make lint` — ESLint de la API.
- `make admin-create` — Crea o promueve un ADMIN con cuota ilimitada.
- `make build` — Compilación de producción de todos los paquetes y aplicaciones.
- `make test` — Tests de la API (Vitest) y de Music Lab (pytest).
- `make db-up` / `make db-down` — PostgreSQL de desarrollo con `docker-compose.yml` (opcional).
- `make db-validate` / `make db-generate` — Validación y generación del cliente Prisma.
- `make db-migrate` / `make db-status` — Migraciones y estado en PostgreSQL.
- `make lab-test` — Ejecuta la suite `pytest` de `services/music-lab` en CPU.
- `make lab-docker-gpu` — Construye la imagen Docker lista para producción GPU.

## Verificación

```bash
make typecheck
make lint
make test
make build
```
