// ─── SON1KVERSE — Entry Point ─────────────────────────────────────────────────

import { buildServer } from './api/server.js'
import { connectDB, disconnectDB } from './storage/client.js'
import { config } from './config/index.js'

async function main() {
  console.log('\n⬡  SON1KVERSE — Creative Operating System')
  console.log(`⬡  Versión: ${config.SYSTEM_VERSION} | Entorno: ${config.NODE_ENV}\n`)

  await connectDB()

  const app = await buildServer()

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n⬡  Recibido ${signal}, apagando...`)
    await app.close()
    await disconnectDB()
    process.exit(0)
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    console.log(`\n⬡  PIXEL online en http://${config.HOST}:${config.PORT}`)
    console.log('⬡  Health: /health')
    console.log('⬡  Orquestar: POST /api/v1/orchestrate\n')
  } catch (err) {
    console.error('❌  Error al iniciar:', err)
    process.exit(1)
  }
}

void main()
