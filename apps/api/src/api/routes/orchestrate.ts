// ─── SON1KVERSE — Orchestrate Route ──────────────────────────────────────────

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { OrchestrationRequestSchema, FeedbackSchema, successResponse } from '../../core/contracts.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { Pixel } from '../../orchestration/Pixel.js'
import { prisma } from '../../storage/client.js'
import { getAuthUserId } from '../request-auth.js'

const pixel = new Pixel()

async function assertProfileOwner(profileId: string, userId: string): Promise<void> {
  const profile = await prisma.artistProfile.findUnique({
    where: { id: profileId },
    select: { userId: true },
  })
  if (profile === null) throw new NotFoundError('Perfil no encontrado')
  if (profile.userId !== userId) throw new ForbiddenError()
}

export async function orchestrateRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/orchestrate — el flujo principal de Pixel
  app.post('/orchestrate', async (req, reply) => {
    const parsed = OrchestrationRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    await assertProfileOwner(parsed.data.profileId, userId)

    const result = await pixel.orchestrate(parsed.data)
    return reply.status(200).send(successResponse(result))
  })

  // POST /api/v1/orchestrate-coherent — canción completa en una sola llamada
  // single-shot a Music Lab con la letra estructurada y los style tags de Pixel.
  app.post('/orchestrate-coherent', async (req, reply) => {
    const parsed = OrchestrationRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    await assertProfileOwner(parsed.data.profileId, userId)

    const result = await pixel.orchestrateCoherentSong(parsed.data)
    return reply.status(200).send(successResponse(result))
  })

  // GET /api/v1/artifacts/:artifactId/audio — descarga autenticada del WAV
  // generado por Pixel. Verifica propiedad del perfil y que la ruta esté
  // confinada a output/tracks/ (sin traversal).
  app.get('/artifacts/:artifactId/audio', async (req, reply) => {
    const { artifactId } = req.params as { artifactId: string }
    if (!artifactId) throw new ValidationError({ artifactId: ['artifactId es requerido'] })

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      select: {
        content: true,
        profile: { select: { userId: true } },
      },
    })
    if (artifact === null) throw new NotFoundError('Artifact no encontrado')
    if (artifact.profile.userId !== getAuthUserId(req)) throw new ForbiddenError()

    let content: unknown = null
    try {
      content = JSON.parse(artifact.content) as unknown
    } catch {
      content = null
    }
    const localWav = typeof content === 'object' && content !== null && 'local_wav' in content
      ? (content as Record<string, unknown>)['local_wav']
      : null
    if (typeof localWav !== 'string') throw new NotFoundError('Audio no disponible todavía')

    const tracksDir = path.resolve(process.cwd(), 'output', 'tracks')
    const file = path.resolve(localWav)
    if (file !== tracksDir && !file.startsWith(`${tracksDir}${path.sep}`)) {
      throw new ForbiddenError('Ruta de audio no permitida')
    }

    const stat = await fs.stat(file).catch(() => null)
    if (stat === null || !stat.isFile()) throw new NotFoundError('Audio no disponible todavía')

    const buffer = await fs.readFile(file)
    const contentType = path.extname(file).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav'
    return reply
      .header('content-type', contentType)
      .header('content-length', String(buffer.byteLength))
      .header('content-disposition', `attachment; filename="${path.basename(file).replace(/["\r\n]/g, '')}"`)
      .header('cache-control', 'private, max-age=0, no-store')
      .send(buffer)
  })

  // POST /api/v1/feedback — feedback del artista sobre un resultado
  app.post('/feedback', async (req, reply) => {
    const parsed = FeedbackSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = getAuthUserId(req)
    const artifact = await prisma.artifact.findUnique({
      where: { id: parsed.data.artifactId },
      select: { profile: { select: { userId: true } } },
    })
    if (artifact === null) throw new NotFoundError('Artifact no encontrado')
    if (artifact.profile.userId !== userId) throw new ForbiddenError()

    await pixel.processFeedback(parsed.data)
    return reply.status(200).send(successResponse({ ok: true }))
  })
}
