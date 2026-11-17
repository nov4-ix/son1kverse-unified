// ─── SON1KVERSE — Logger de proceso (pino) ───────────────────────────────────
// Los servicios no usan console.log: el logger respeta LOG_LEVEL y en
// desarrollo usa pino-pretty para mantener la terminal legible.

import { pino } from 'pino'
import { config } from '../config/index.js'

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
})
