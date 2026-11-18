# ⬡ SON1KVERSE

**Creative Operating System — Pixel-powered artistic identity orchestration**

> La IA no reemplaza al artista. La IA amplifica al artista.  
> El valor no está en los modelos. Está en la memoria, la continuidad y la identidad.

---

## Qué es esto

SON1KVERSE no es un generador musical aislado. Es un sistema creativo con identidad propia.

Es un **sistema operativo creativo** que aprende cómo creas y usa múltiples modelos de IA para amplificar tu identidad artística.

El producto central es **PIXEL** — un director creativo IA que analiza contexto, memoria e identidad antes de decidir qué hacer.

---

## Setup rápido (Ubuntu, monorepo)

```bash
make setup
make db-migrate
```

`make setup` crea `apps/api/.env` desde `.env.example` y genera un
`JWT_SECRET` aleatorio. Si quieres proveedores de IA, añade
`OPENROUTER_API_KEY` en ese archivo.

Arranca API + Music Lab + Web desde la raíz (API en `:3001`):
```bash
make dev
```

---

## Flujo principal

```
Usuario → Perfil Artístico → Memoria → Análisis
       → Pixel (Orquestador) → Agente → Modelo
       → Resultado → Feedback → Actualización de Memoria
```

---

## Stack

- **Runtime**: Node.js 20 + TypeScript ESM
- **API**: Fastify + Zod
- **ORM**: Prisma + PostgreSQL
- **Providers**: OpenRouter, Ollama (local)
- **Testing**: Vitest

---

## Endpoints

### Auth
```
POST /api/v1/auth/register            — Crear usuario → devuelve JWT
POST /api/v1/auth/login               — Login → devuelve JWT
```

### Orquestación (PIXEL)
```
GET  /health                          — Estado del sistema
POST /api/v1/orchestrate              — Pixel orquesta una solicitud
                                         (MUSIC espera a que el audio termine:
                                          el artifact se persiste en estado done)
POST /api/v1/feedback                 — Feedback sobre un resultado
                                         (score < 0.3 debilita el perfil,
                                          >= 0.5 con tags lo refina)
```

### Perfil artístico
```
POST   /api/v1/profile                — Crear perfil artístico
GET    /api/v1/profile/:id            — Obtener perfil
GET    /api/v1/profile/alias/:alias   — Obtener perfil por alias
PATCH  /api/v1/profile/:id            — Actualizar perfil
DELETE /api/v1/profile/:id            — Eliminar perfil
```

### Memoria creativa
```
POST /api/v1/memory                   — Guardar entrada de memoria
GET  /api/v1/memory/search            — Buscar en memoria creativa
POST /api/v1/memory/:id/score         — Puntuar una memoria
POST /api/v1/memory/consolidate/:profileId — Consolidar memoria
```

### Audio Engine (requiere `Authorization: Bearer <JWT>`)
```
GET  /api/v1/audio/health             — Salud del motor Python (siempre público)
POST /api/v1/audio/generate           — Encolar generación de audio
GET  /api/v1/audio/status/:trackId    — Estado del track
GET  /api/v1/audio/download/:trackId  — Descargar WAV (proxy con JWT)
```

> El motor Python (`audio_engine/`, puerto 8001) escucha **sólo en 127.0.0.1**:
> no tiene autenticación propia, la seguridad vive en el backend Node.

---

## Ejemplo de uso

```bash
# Crear perfil artístico
curl -X POST http://localhost:3001/api/v1/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "alias": "nov4-ix",
    "genres": ["synthwave", "cyberpunk", "dark pop"],
    "bpmRange": { "min": 90, "max": 130, "preferred": 110 },
    "aesthetics": ["neon", "nostalgia digital", "retrofuturismo"],
    "narrative": "Historias de identidad y resistencia en un mundo tecnológico.",
    "emotions": ["nostalgia", "melancholy", "rebellion"],
    "references": [{ "artist": "Perturbator", "elements": ["synthwave oscuro", "narrativa cyberpunk"] }]
  }'

# Orquestar con Pixel
curl -X POST http://localhost:3001/api/v1/orchestrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "prompt": "Necesito un hook melancólico sobre soledad digital",
    "profileId": "profile_id_aqui",
    "sessionId": "session_id_aqui"
  }'
```

---

## Arquitectura

```
src/
├── core/           — Tipos, interfaces, contratos, eventos (sin dependencias)
├── config/         — Variables de entorno validadas con Zod
├── storage/        — Prisma client + repositorios
├── identity/       — Perfil artístico persistente
├── memory/         — Memoria creativa con embeddings
├── analysis/       — Análisis de intención creativa → CreativeIntent
├── orchestration/  — PIXEL + Router inteligente
├── agents/         — LyricsAgent, MusicAgent, VisualAgent, StrategyAgent
├── providers/      — OpenRouter, Ollama (adaptadores puros)
└── api/            — Fastify routes + plugins
```

---

## ALVAE

> Alma · Vibración · Energía  
> *Lo imperfecto también es sagrado.*
