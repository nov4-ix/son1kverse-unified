// ─── SON1KVERSE — API Server ──────────────────────────────────────────────────

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fjwt from '@fastify/jwt'
import { config } from '../config/index.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { authRoutes } from './routes/auth.js'
import { orchestrateRoutes } from './routes/orchestrate.js'
import { profileRoutes } from './routes/profile.js'
import { memoryRoutes } from './routes/memory.js'

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
  await app.register(cors, {
    origin: config.NODE_ENV === 'development' ? true : ['https://son1kverse.com'],
  })
  await app.register(helmet)
  await app.register(fjwt, {
    secret: config.JWT_SECRET,
  })
  await app.register(errorHandlerPlugin)

  // Auth: JWT obligatorio en /api/v1/audio/* (generate, status, download).
  // - /audio/health es siempre público (monitorización / probes).
  // - En desarrollo se permite acceder SIN token para no frenar el loop local
  //   (e2e-audio.mjs). Si se envía token, se valida igualmente.
  // - En producción NO hay bypass: todo /api/v1/audio/* exige Bearer válido.
  const isDev = config.NODE_ENV === 'development'
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/v1/audio')) return
    if (path === '/api/v1/audio/health') return

    if (isDev && request.headers.authorization === undefined) {
      request.log.warn({ path }, '[auth] Modo desarrollo: /api/v1/audio/* sin JWT')
      return
    }

    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({
        success: false,
        error:   'Unauthorized',
        message: 'Bearer JWT requerido para /api/v1/audio/* (POST /api/v1/auth/login)',
      })
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

  return app
}
