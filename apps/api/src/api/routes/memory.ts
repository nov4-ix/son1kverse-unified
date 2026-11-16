// ─── SON1KVERSE — Memory Routes ──────────────────────────────────────────────

import type { FastifyInstance } from 'fastify'
import { SaveMemorySchema, SearchMemorySchema, successResponse } from '../../core/contracts.js'
import { ValidationError } from '../../core/errors.js'
import { MemoryService } from '../../memory/MemoryService.js'

const memoryService = new MemoryService()

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/memory — guardar una memoria manualmente
  app.post('/memory', async (req, reply) => {
    const parsed = SaveMemorySchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const memory = await memoryService.saveMemory(parsed.data)
    return reply.status(201).send(successResponse(memory))
  })

  // GET /api/v1/memory/search?query=...&profileId=...&limit=10
  app.get('/memory/search', async (req, reply) => {
    const parsed = SearchMemorySchema.safeParse(req.query)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

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
      const updated = await memoryService.updateMemory(req.params.id, req.body.score)
      return reply.send(successResponse(updated))
    },
  )

  // POST /api/v1/memory/consolidate/:profileId — consolidar memoria
  app.post<{ Params: { profileId: string } }>(
    '/memory/consolidate/:profileId',
    async (req, reply) => {
      await memoryService.consolidate(req.params.profileId)
      return reply.send(successResponse({ ok: true }))
    },
  )
}
