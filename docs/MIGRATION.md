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
