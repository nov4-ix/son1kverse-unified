// ─── SON1KVERSE — Environment Config ──────────────────────────────────────────
// Toda variable de entorno pasa por Zod antes de usarse.
// Si falta algo crítico, el proceso falla al arrancar con mensaje claro.

import { z } from 'zod'

try {
  const loadEnvFile = (process as typeof process & { loadEnvFile?: () => void }).loadEnvFile
  loadEnvFile?.()
} catch {
  // .env es opcional: en producción las variables vienen del entorno.
}

const BooleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')

const ConfigSchema = z.object({
  NODE_ENV:    z.enum(['development', 'production', 'test']).default('development'),
  PORT:        z.coerce.number().default(3001),
  HOST:        z.string().default('0.0.0.0'),

  // Lista separada por comas. Nunca se hardcodean orígenes en el servidor.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Bypass explícito y solo para desarrollo local. Se ignora en production.
  ALLOW_ANON_DEV: BooleanFromString.default(false),
  // Los ADMIN no consumen cuota cuando esto es true.
  ADMIN_UNLIMITED: BooleanFromString.default(true),

  DATABASE_URL: z.string().default('postgresql://son1kverse:son1kverse@localhost:5432/son1kverse?schema=public'),

  JWT_SECRET:     z.string()
    .min(32, 'JWT_SECRET debe tener al menos 32 chars')
    .refine(v => !v.startsWith('CHANGE_THIS'), {
      message: 'JWT_SECRET sigue siendo el placeholder de .env.example — genera uno real: openssl rand -base64 64',
    }),
  JWT_EXPIRES_IN: z.string().default('7d'),

  OPENAI_API_KEY:      z.string().optional(),
  OPENROUTER_API_KEY:  z.string().optional(),
  OLLAMA_BASE_URL:     z.string().url().default('http://localhost:11434'),
  MUSIC_LAB_URL:     z.string().url().default('http://127.0.0.1:8002'),
  MUSIC_LAB_API_KEY: z.string().default(''),
  MUSIC_LAB_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  MUSIC_LAB_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MUSIC_LAB_RETRY_BACKOFF_MS: z.coerce.number().int().min(100).max(10_000).default(500),

  PIXEL_DEFAULT_MODEL:  z.string().default('anthropic/claude-3-haiku'),
  PIXEL_ANALYSIS_MODEL: z.string().default('anthropic/claude-3-haiku'),

  EMBEDDING_MODEL:    z.string().default('text-embedding-ada-002'),
  MAX_MEMORY_CONTEXT: z.coerce.number().int().min(1).max(50).default(10),

  LOG_LEVEL:       z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  SYSTEM_VERSION:  z.string().default('0.1.0'),
})

function loadConfig() {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    console.error('\n❌  SON1KVERSE — Configuración inválida:\n')
    for (const [field, issues] of Object.entries(result.error.flatten().fieldErrors)) {
      console.error(`  ${field}: ${(issues as string[]).join(', ')}`)
    }
    console.error('\nCopia .env.example a .env y completa los valores requeridos.\n')
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
export type Config = z.infer<typeof ConfigSchema>
