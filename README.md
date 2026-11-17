# SON1KVERS3 — Ecosistema Creativo Soberano (Genome 2.0)

> *"Lo imperfecto también es sagrado."* — **Ctrl+Alt= Humanity**

Monorepo unificado que consolida la arquitectura backend, el motor neuronal de síntesis musical propio y la interfaz dual **XentriX / ALVAE** inspirada en *"SON1KVERS3: La Vibración Prohibida"*.

## Arquitectura del Monorepo

- **`apps/web`** (`@son1k/web`): Frontend React 18 + Vite + Tailwind CSS con dualidad de modos (`Ctrl + Alt + H` / `ctrl+alt=Security` → `ctrl+ALT=humanity`), logotipo oficial SVG, simbología **ALVAE (`◯⚡`)**, **La Terminal** con **Pixel A&R Digital** autónomo, **4 Perillas Literarias + Quinto Acorde**, **Ghost Studio** y **El Santuario**.
- **`apps/api`** (`@son1k/api`): Backend Fastify + TypeScript ESM strict con orquestación de agentes (`MusicAgent`, `LyricsAgent`, `StrategyAgent`, `VisualAgent`), identidad de **Pixel** como sistema nervioso central y cliente tipado hacia Music Lab.
- **`packages/db`** (`@son1k/db`): Esquema PostgreSQL unificado en Prisma (`User`, `ArtistProfile`, `Memory`, `AlvaeAccount`, `Generation`, `Track`, `Project`).
- **`packages/shared-ui`** (`@son1k/shared-ui`): Componentes vectoriales oficiales (`PlatformLogo`, `AlvaeSymbol`) y controles táctiles (`LiteraryKnob`).
- **`services/music-lab`**: Microservicio Python 3.11 + FastAPI aislado para generación de audio soberana (sin dependencias de APIs de terceros):
  - **Motores neuronales:** Adaptadores perezosos para **ACE-Step 1.5** (generación completa, *repainting*, *covers* y *stems*) y **HeartMuLa**.
  - **DSP Propio:** **HAM** (*Harmonic Alignment Module*) y **`MasteringChain`** (-14 LUFS).
  - **Modo CPU (`simulation`):** Síntesis determinista en CPU para desarrollo local sin GPU y `Dockerfile.gpu` listo para despliegue Serverless GPU (RunPod / Modal).

## Arranque Rápido en Local

```bash
# 1. Instalar dependencias (Node + Python)
make setup

# 2. Levantar Music Lab (CPU simulation), API (:3001) y Web (:5173)
make lab-dev
make dev
```

## Comandos Principales (`Makefile`)

- `make typecheck` — Validación estricta de TypeScript (`tsc --noEmit`) en todo el workspace.
- `make build` — Compilación de producción de todos los paquetes y aplicaciones.
- `make lab-test` — Ejecuta la suite `pytest` de `services/music-lab` en CPU.
- `make lab-docker-gpu` — Construye la imagen Docker lista para producción GPU.
