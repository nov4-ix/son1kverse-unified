// ─── SON1KVERSE — Profile Routes ─────────────────────────────────────────────
// Propiedad: el userId sale siempre del JWT. Un perfil ajeno nunca se expone
// completo; por alias solo se devuelve una vista pública mínima.

import type { FastifyInstance } from 'fastify'
import { CreateProfileSchema, UpdateProfileSchema, successResponse } from '../../core/contracts.js'
import { ForbiddenError, ValidationError } from '../../core/errors.js'
import { IdentityService } from '../../identity/IdentityService.js'
import { getAuthUserId } from '../request-auth.js'

const identity = new IdentityService()

// El userId jamás se acepta desde el body: se inyecta desde el claim `sub`.
const CreateOwnedProfileSchema = CreateProfileSchema.omit({ userId: true })

function publicProfileView(profile: {
  alias: string
  genres: string[]
  aesthetics: string[]
}): { alias: string; genres: string[]; aesthetics: string[] } {
  return {
    alias: profile.alias,
    genres: profile.genres,
    aesthetics: profile.aesthetics,
  }
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/profile — crear perfil artístico para el usuario del token
  app.post('/profile', async (req, reply) => {
    const parsed = CreateOwnedProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    const profile = await identity.createProfile({ ...parsed.data, userId })
    return reply.status(201).send(successResponse(profile))
  })

  // GET /api/v1/profile/:id — solo el dueño
  app.get<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    const userId = getAuthUserId(req)
    const profile = await identity.getProfile(req.params.id)
    if (profile.userId !== userId) throw new ForbiddenError()
    return reply.send(successResponse(profile))
  })

  // GET /api/v1/profile/alias/:alias — dueño: perfil completo; resto: vista mínima
  app.get<{ Params: { alias: string } }>('/profile/alias/:alias', async (req, reply) => {
    const userId = getAuthUserId(req)
    const profile = await identity.getProfileByAlias(req.params.alias)
    if (profile === null) {
      return reply.status(404).send({
        success: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Perfil no encontrado' },
      })
    }
    if (profile.userId !== userId) {
      return reply.send(successResponse(publicProfileView(profile)))
    }
    return reply.send(successResponse(profile))
  })

  // PATCH /api/v1/profile/:id — solo el dueño
  app.patch<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    const parsed = UpdateProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    const existing = await identity.getProfile(req.params.id)
    if (existing.userId !== userId) throw new ForbiddenError()

    const profile = await identity.updateProfile(req.params.id, parsed.data)
    return reply.send(successResponse(profile))
  })

  // DELETE /api/v1/profile/:id — solo el dueño
  app.delete<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    const userId = getAuthUserId(req)
    const existing = await identity.getProfile(req.params.id)
    if (existing.userId !== userId) throw new ForbiddenError()

    await identity.deleteProfile(req.params.id)
    return reply.status(204).send()
  })
}
