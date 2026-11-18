// ─── SON1KVERSE — Session Routes ─────────────────────────────────────────────
// El userId sale siempre del JWT. Una sesión solo puede crearse sobre un
// perfil propio y solo su dueño puede consultarla o cerrarla.

import type { FastifyInstance } from 'fastify'
import { CreateSessionSchema, successResponse } from '../../core/contracts.js'
import { ForbiddenError, SessionNotFoundError, ValidationError } from '../../core/errors.js'
import { SessionService, type SessionRecord } from '../../sessions/SessionService.js'
import { getAuthUserId } from '../request-auth.js'

const sessions = new SessionService()

// El userId jamás se acepta desde el body: se inyecta desde el claim `sub`.
const CreateOwnedSessionSchema = CreateSessionSchema.omit({ userId: true })

function sessionView(session: SessionRecord) {
  return {
    id:        session.id,
    profileId: session.profileId,
    status:    session.status,
    metadata:  session.metadata,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

async function getOwnedSession(id: string, userId: string): Promise<SessionRecord> {
  const session = await sessions.getSession(id)
  if (session === null) throw new SessionNotFoundError(id)
  if (session.userId !== userId) throw new ForbiddenError()
  return session
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/sessions — abrir una sesión creativa para un perfil propio
  app.post('/sessions', async (req, reply) => {
    const parsed = CreateOwnedSessionSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    const session = await sessions.createSession({ ...parsed.data, userId })
    return reply.status(201).send(successResponse(sessionView(session)))
  })

  // GET /api/v1/sessions/:id — solo el dueño
  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const session = await getOwnedSession(req.params.id, getAuthUserId(req))
    return reply.send(successResponse(sessionView(session)))
  })

  // POST /api/v1/sessions/:id/close — cierra la sesión (idempotente)
  app.post<{ Params: { id: string } }>('/sessions/:id/close', async (req, reply) => {
    const session = await getOwnedSession(req.params.id, getAuthUserId(req))
    await sessions.closeSession(session.id)
    return reply.send(successResponse({ id: session.id, status: 'completed' }))
  })
}
