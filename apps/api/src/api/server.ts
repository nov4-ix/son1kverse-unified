// ─── SON1KVERSE — API Server ──────────────────────────────────────────────────

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fjwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { config } from '../config/index.js'
import { errorResponse } from '../core/contracts.js'
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
  '/api/v1/music/health',
  '/api/v1/music/capabilities',
])

function corsOrigins(): string[] {
  return config.CORS_ORIGINS
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
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
  })

  // ─── Health check ────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:  'ok',
    version: config.SYSTEM_VERSION,
    pixel:   'online',
    ts:      new Date().toISOString(),
  }))

  // ─── API Routes ──────────────────────────────────────────────────────────────
  await app.register(authRoutes,        { prefix: '/api/v1' })
  await app.register(orchestrateRoutes, { prefix: '/api/v1' })
  await app.register(profileRoutes,     { prefix: '/api/v1' })
  await app.register(memoryRoutes,      { prefix: '/api/v1' })
  await app.register(musicRoutes,       { prefix: '/api/v1' })
  await app.register(sessionRoutes,     { prefix: '/api/v1' })

  return app
}
