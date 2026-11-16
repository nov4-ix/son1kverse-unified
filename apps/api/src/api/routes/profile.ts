// ─── SON1KVERSE — Profile Routes ─────────────────────────────────────────────

import type { FastifyInstance } from 'fastify'
import { CreateProfileSchema, UpdateProfileSchema, successResponse } from '../../core/contracts.js'
import { ValidationError } from '../../core/errors.js'
import { IdentityService } from '../../identity/IdentityService.js'

const identity = new IdentityService()

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/profile — crear perfil artístico
  app.post('/profile', async (req, reply) => {
    const parsed = CreateProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const profile = await identity.createProfile(parsed.data)
    return reply.status(201).send(successResponse(profile))
  })

  // GET /api/v1/profile/:id
  app.get<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    const profile = await identity.getProfile(req.params.id)
    return reply.send(successResponse(profile))
  })

  // GET /api/v1/profile/alias/:alias
  app.get<{ Params: { alias: string } }>('/profile/alias/:alias', async (req, reply) => {
    const profile = await identity.getProfileByAlias(req.params.alias)
    return reply.send(successResponse(profile))
  })

  // PATCH /api/v1/profile/:id
  app.patch<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    const parsed = UpdateProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const profile = await identity.updateProfile(req.params.id, parsed.data)
    return reply.send(successResponse(profile))
  })

  // DELETE /api/v1/profile/:id
  app.delete<{ Params: { id: string } }>('/profile/:id', async (req, reply) => {
    await identity.deleteProfile(req.params.id)
    return reply.status(204).send()
  })
}
