// ─── SON1KVERSE — API Server ──────────────────────────────────────────────────

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fjwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { config } from '../config/index.js'
import { errorResponse } from '../core/contracts.js'
import { musicLabClient } from '../clients/musicLab.js'
import { prisma } from '../storage/client.js'
import { isSessionActive } from '../services/AuthTokenService.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { authRoutes } from './routes/auth.js'
import { orchestrateRoutes } from './routes/orchestrate.js'
import { profileRoutes } from './routes/profile.js'
import { memoryRoutes } from './routes/memory.js'
import { musicRoutes } from './routes/music.js'
import { sessionRoutes } from './routes/sessions.js'

const PUBLIC_API_PATHS = new Set([
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/verify-email',
  '/api/v1/auth/password/forgot',
  '/api/v1/auth/password/reset',
  '/api/v1/music/health',
  '/api/v1/music/capabilities',
])

function corsOrigins(): string[] {
  return config.CORS_ORIGINS
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

type DependencyCheck = {
  status: 'ok' | 'error'
  latencyMs: number
  error?: string
}

const DEPENDENCY_TIMEOUT_MS = 2_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout después de ${timeoutMs} ms`)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function checkPostgres(): Promise<DependencyCheck> {
  const started = Date.now()
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DEPENDENCY_TIMEOUT_MS)
    return { status: 'ok', latencyMs: Date.now() - started }
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function checkMusicLab(): Promise<DependencyCheck> {
  const started = Date.now()
  try {
    const health = await withTimeout(musicLabClient.health(), DEPENDENCY_TIMEOUT_MS)
    if (health.status !== 'ok') {
      throw new Error(`Music Lab respondió con estado ${health.status}`)
    }
    return { status: 'ok', latencyMs: Date.now() - started }
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function dependencySnapshot(): Promise<{
  ok: boolean
  checks: { postgres: DependencyCheck; musicLab: DependencyCheck }
}> {
  const [postgres, musicLab] = await Promise.all([checkPostgres(), checkMusicLab()])
  return {
    ok: postgres.status === 'ok' && musicLab.status === 'ok',
    checks: { postgres, musicLab },
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  })

  // ─── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, { origin: corsOrigins() })
  await app.register(helmet)
  await app.register(fjwt, {
    secret: config.JWT_SECRET,
  })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => {
      request.log.warn({ path: request.url }, '[rate-limit] solicitud limitada')
      return errorResponse(
        'RATE_LIMITED',
        `Demasiadas solicitudes. Reintenta en ${context.after}.`,
        { max: context.max, after: context.after },
      )
    },
  })
  // No usar app.register: setErrorHandler debe aplicar al scope raíz.
  await errorHandlerPlugin(app)

  // ─── Auth global ────────────────────────────────────────────────────────────
  // Todo /api/v1/* exige JWT salvo register, login y el health del motor.
  // /health (sin prefijo) queda público. ALLOW_ANON_DEV es un bypass explícito,
  // solo local y nunca efectivo con NODE_ENV=production.
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/v1/')) return
    if (PUBLIC_API_PATHS.has(path)) return

    const anonymousDev =
      config.ALLOW_ANON_DEV &&
      config.NODE_ENV !== 'production' &&
      request.headers.authorization === undefined

    if (anonymousDev) {
      request.log.warn({ path }, '[auth] ALLOW_ANON_DEV activo: request sin JWT')
      return
    }

    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send(
        errorResponse(
          'UNAUTHORIZED',
          'Bearer JWT requerido. Inicia sesión en POST /api/v1/auth/login.',
        ),
      )
    }

    const claims = request.user as Record<string, unknown>
    const jti = claims['jti']
    if (typeof jti === 'string' && jti !== '') {
      if (!(await isSessionActive(jti))) {
        return reply.status(401).send(
          errorResponse('SESSION_REVOKED', 'La sesión fue revocada. Inicia sesión de nuevo.'),
        )
      }
    } else if (config.REQUIRE_SESSION_CLAIM) {
      return reply.status(401).send(
        errorResponse('SESSION_REQUIRED', 'El token no tiene una sesión revocable. Inicia sesión de nuevo.'),
      )
    }
  })

  // ─── Health / readiness ──────────────────────────────────────────────────────
  // /health y /ready comprueban dependencias reales. Si Postgres o Music Lab
  // fallan, responden 503 para que el orquestador no envíe tráfico.
  app.get('/health', async (_request, reply) => {
    const snapshot = await dependencySnapshot()
    return reply.status(snapshot.ok ? 200 : 503).send({
      status: snapshot.ok ? 'ok' : 'degraded',
      version: config.SYSTEM_VERSION,
      pixel: snapshot.ok ? 'online' : 'degraded',
      ts: new Date().toISOString(),
      checks: snapshot.checks,
    })
  })

  app.get('/ready', async (_request, reply) => {
    const snapshot = await dependencySnapshot()
    return reply.status(snapshot.ok ? 200 : 503).send({
      ready: snapshot.ok,
      status: snapshot.ok ? 'ready' : 'not_ready',
      version: config.SYSTEM_VERSION,
      ts: new Date().toISOString(),
      checks: snapshot.checks,
    })
  })

  // ─── API Routes ──────────────────────────────────────────────────────────────
  await app.register(authRoutes,        { prefix: '/api/v1' })
  await app.register(orchestrateRoutes, { prefix: '/api/v1' })
  await app.register(profileRoutes,     { prefix: '/api/v1' })
  await app.register(memoryRoutes,      { prefix: '/api/v1' })
  await app.register(musicRoutes,       { prefix: '/api/v1' })
  await app.register(sessionRoutes,     { prefix: '/api/v1' })

  return app
}
