// ─── SON1KVERSE — Error Handler Plugin ───────────────────────────────────────

import type { FastifyInstance, FastifyError } from 'fastify'
import { ZodError } from 'zod'
import { Son1kverseError } from '../../core/errors.js'
import { errorResponse } from '../../core/contracts.js'

export async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError | Error, _req, reply) => {
    // Error de validación Zod
    if (error instanceof ZodError) {
      return reply.status(400).send(
        errorResponse('VALIDATION_ERROR', 'Datos inválidos', error.flatten()),
      )
    }

    // Errores del sistema SON1KVERSE
    if (error instanceof Son1kverseError) {
      return reply.status(error.statusCode).send(
        errorResponse(error.code, error.message, error.details),
      )
    }

    // Error genérico
    console.error('[API] Unhandled error:', error)
    return reply.status(500).send(
      errorResponse('INTERNAL_ERROR', 'Error interno del servidor'),
    )
  })
}
