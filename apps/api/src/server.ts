// ─── SON1KVERSE — Entry Point ─────────────────────────────────────────────────

import { buildServer } from './api/server.js'
import { connectDB, disconnectDB } from './storage/client.js'
import { config } from './config/index.js'
import { logger } from './lib/logger.js'

async function main() {
  logger.info('SON1KVERSE — Creative Operating System')
  logger.info({ version: config.SYSTEM_VERSION, env: config.NODE_ENV }, 'Iniciando')

  await connectDB()

  const app = await buildServer()

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Señal recibida, apagando')
    await app.close()
    await disconnectDB()
    process.exit(0)
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    logger.info({ host: config.HOST, port: config.PORT }, 'PIXEL online')
    logger.info('Health: /health | Orquestar: POST /api/v1/orchestrate')
  } catch (err) {
    logger.error({ err }, 'Error al iniciar')
    process.exit(1)
  }
}

void main()
