// ─── SON1KVERSE — Identidad desde el JWT ─────────────────────────────────────
// El userId SIEMPRE sale del claim `sub`. Nunca del body ni de un query param.

import type { FastifyRequest } from 'fastify'
import { UnauthorizedError } from '../core/errors.js'

export function getAuthUserId(request: FastifyRequest): string {
  const claims = request.user
  if (typeof claims !== 'object' || claims === null) throw new UnauthorizedError()

  const sub = (claims as Record<string, unknown>)['sub']
  if (typeof sub !== 'string' || sub === '') throw new UnauthorizedError()
  return sub
}

export function getAuthSessionId(request: FastifyRequest): string | null {
  const claims = request.user
  if (typeof claims !== 'object' || claims === null) return null

  const jti = (claims as Record<string, unknown>)['jti']
  return typeof jti === 'string' && jti !== '' ? jti : null
}
