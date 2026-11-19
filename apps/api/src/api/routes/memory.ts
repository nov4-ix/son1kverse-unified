// ─── SON1KVERSE — Memory Routes ──────────────────────────────────────────────
// Toda memoria pertenece a un ArtistProfile y todo ArtistProfile a un User.
// El userId sale del JWT; nunca se acepta como parámetro de confianza.

import type { FastifyInstance } from 'fastify'
import { SaveMemorySchema, SearchMemorySchema, successResponse } from '../../core/contracts.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { MemoryService } from '../../memory/MemoryService.js'
import { prisma } from '../../storage/client.js'
import { getAuthUserId } from '../request-auth.js'

const memoryService = new MemoryService()

async function assertProfileOwner(profileId: string, userId: string): Promise<void> {
  const profile = await prisma.artistProfile.findUnique({
    where: { id: profileId },
    select: { userId: true },
  })
  if (profile === null) throw new NotFoundError('Perfil no encontrado')
  if (profile.userId !== userId) throw new ForbiddenError()
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/memory — guardar una memoria manualmente
  app.post('/memory', async (req, reply) => {
    const parsed = SaveMemorySchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    await assertProfileOwner(parsed.data.profileId, userId)

    const memory = await memoryService.saveMemory(parsed.data)
    return reply.status(201).send(successResponse(memory))
  })

  // GET /api/v1/memory/search?query=...&profileId=...&limit=10
  app.get('/memory/search', async (req, reply) => {
    const parsed = SearchMemorySchema.safeParse(req.query)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    await assertProfileOwner(parsed.data.profileId, userId)

    const memories = await memoryService.searchContext(
      parsed.data.query,
      parsed.data.profileId,
      parsed.data.limit,
    )
    return reply.send(successResponse(memories))
  })

  // POST /api/v1/memory/:id/score — actualizar relevancia de una memoria
  app.post<{ Params: { id: string }; Body: { score: number } }>(
    '/memory/:id/score',
    async (req, reply) => {
      const userId = getAuthUserId(req)
      const memory = await prisma.memory.findUnique({
        where: { id: req.params.id },
        select: { profileId: true },
      })
      if (memory === null) throw new NotFoundError('Memoria no encontrada')
      await assertProfileOwner(memory.profileId, userId)

      const updated = await memoryService.updateMemory(req.params.id, req.body.score)
      return reply.send(successResponse(updated))
    },
  )

  // POST /api/v1/memory/consolidate/:profileId — consolidar memoria
  app.post<{ Params: { profileId: string } }>(
    '/memory/consolidate/:profileId',
    async (req, reply) => {
      const userId = getAuthUserId(req)
      await assertProfileOwner(req.params.profileId, userId)

      await memoryService.consolidate(req.params.profileId)
      return reply.send(successResponse({ ok: true }))
    },
  )
}
