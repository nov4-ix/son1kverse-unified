// ─── SON1KVERSE — Music Lab Routes ───────────────────────────────────────────
// Music Lab es el único motor. Cada job se registra en Generation con el
// userId del JWT y su id externo; GET/audio verifican propiedad.
// La cuota se consume de forma atómica antes de encolar y se devuelve si el
// encolado o el job fallan.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { GenerationStatus } from '@son1k/db'
import { successResponse } from '../../core/contracts.js'
import { ForbiddenError, NotFoundError, Son1kverseError, ValidationError } from '../../core/errors.js'
import {
  MusicLabClientError,
  musicLabClient,
  type MusicLabJob,
  type MusicLabStem,
} from '../../clients/musicLab.js'
import { prisma } from '../../storage/client.js'
import { config } from '../../config/index.js'
import { getAuthUserId } from '../request-auth.js'
import { consumeGenerationQuota, refundGenerationQuota } from '../../services/QuotaService.js'
import { logger } from '../../lib/logger.js'

const MusicLabStemSchema = z.enum(['drums', 'bass', 'other'])

const MusicLabGenerateSchema = z.object({
  prompt:               z.string().min(1).max(4000),
  lyrics:               z.string().max(20_000).nullable().optional(),
  duration_s:           z.number().gt(0).max(600).default(180),
  seed:                 z.number().int().min(0).max(2 ** 32 - 1).optional(),
  bpm:                  z.number().int().min(30).max(300).optional(),
  key:                  z.string().min(1).max(16).optional(),
  style_tags:           z.array(z.string()).max(32).optional(),
  reference_audio_path: z.string().nullable().optional(),
  output_format:        z.enum(['wav', 'mp3']).default('wav'),
  master:               z.boolean().default(false),
  engine:               z.enum(['simulation', 'ace-step']).nullable().optional(),
  quality_preset:       z.string().min(1).max(32).optional(),
})

const MusicLabRepaintSchema = MusicLabGenerateSchema.extend({
  source_audio_path: z.string().min(1),
  start_s:           z.number().min(0),
  end_s:             z.number().gt(0),
}).refine((value) => value.start_s < value.end_s, {
  message: 'start_s debe ser menor que end_s',
})

const MusicLabCoverSchema = MusicLabGenerateSchema.extend({
  source_audio_path: z.string().min(1),
})

const MusicLabStemsSchema = MusicLabGenerateSchema.extend({
  source_audio_path: z.string().nullable().optional(),
})

const JobParamsSchema = z.object({
  jobId: z.string().min(1),
})

const AudioQuerySchema = z.object({
  stem: MusicLabStemSchema.optional(),
})

function rethrowUpstream(error: unknown): never {
  if (error instanceof MusicLabClientError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502
    throw new Son1kverseError(error.message, error.code, status, error.details)
  }
  throw error
}

type GenerationRow = {
  id: string
  userId: string
  status: string
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingTimeMs: number | null
}

async function getOwnedGeneration(jobId: string, userId: string): Promise<GenerationRow> {
  const generation = await prisma.generation.findUnique({
    where: { externalJobId: jobId },
    select: {
      id: true,
      userId: true,
      status: true,
      processingStartedAt: true,
      processingCompletedAt: true,
      processingTimeMs: true,
    },
  })
  if (generation === null) throw new NotFoundError('Job no encontrado')
  if (generation.userId !== userId) throw new ForbiddenError()
  return generation
}

async function recordGeneration(
  userId: string,
  jobId: string,
  operation: 'generate' | 'repaint' | 'cover' | 'stems',
  params: { prompt: string; duration_s?: number | undefined; bpm?: number | undefined; key?: string | undefined; style_tags?: string[] | undefined; engine?: string | null | undefined },
): Promise<string> {
  const generation = await prisma.generation.create({
    data: {
      userId,
      externalJobId: jobId,
      prompt: params.prompt,
      duration: Math.max(1, Math.round(params.duration_s ?? 180)),
      tempo: params.bpm ?? null,
      key: params.key ?? null,
      instruments: [],
      style: params.style_tags?.join(', ') ?? null,
      genre: params.style_tags?.[0] ?? null,
      status: GenerationStatus.QUEUED,
      modelVersion: params.engine ?? 'music-lab',
      errorMessage: operation === 'generate' ? null : `operation=${operation}`,
    },
    select: { id: true },
  })
  return generation.id
}

function statusForJob(status: MusicLabJob['status']): GenerationStatus {
  switch (status) {
    case 'running':
      return GenerationStatus.PROCESSING
    case 'succeeded':
      return GenerationStatus.COMPLETED
    case 'failed':
      return GenerationStatus.FAILED
    case 'queued':
    default:
      return GenerationStatus.QUEUED
  }
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function syncGeneration(
  generation: GenerationRow,
  job: MusicLabJob,
): Promise<void> {
  const now = new Date()
  const terminal = job.status === 'succeeded' || job.status === 'failed'
  const startedAt = generation.processingStartedAt
    ?? (job.status === 'queued' ? null : now)
  const completedAt = terminal ? (generation.processingCompletedAt ?? now) : null
  const processingTimeMs = terminal && startedAt !== null
    ? Math.max(0, completedAt!.getTime() - startedAt.getTime())
    : generation.processingTimeMs
  const audioPath = job.result !== null && 'audio_path' in job.result
    ? job.result.audio_path
    : null

  const nextStatus = statusForJob(job.status)
  const data = {
    status: nextStatus,
    audioUrl: audioPath ?? undefined,
    processingStartedAt: startedAt ?? undefined,
    processingCompletedAt: completedAt ?? undefined,
    processingTimeMs: processingTimeMs ?? undefined,
    errorMessage: job.error?.message ?? null,
  }

  // Reclama la transición terminal de forma atómica: polling y watcher pueden
  // sincronizar el mismo job a la vez sin duplicar logs ni reembolsos.
  let transitioned = true
  if (nextStatus === GenerationStatus.COMPLETED || nextStatus === GenerationStatus.FAILED) {
    const { count } = await prisma.generation.updateMany({
      where: {
        id: generation.id,
        status: { notIn: [GenerationStatus.COMPLETED, GenerationStatus.FAILED] },
      },
      data,
    })
    transitioned = count > 0
  } else {
    await prisma.generation.update({ where: { id: generation.id }, data })
  }

  if (!transitioned) return

  if (job.status === 'failed' && generation.status !== GenerationStatus.FAILED) {
    await refundGenerationQuota(generation.userId)
    logger.info({ jobId: job.job_id, userId: generation.userId }, 'Cuota devuelta por job fallido')
  }

  if (nextStatus === GenerationStatus.COMPLETED && generation.status !== GenerationStatus.COMPLETED) {
    const metadata = job.result?.metadata ?? {}
    const compute = metadata['compute']
    const computeMetrics = typeof compute === 'object' && compute !== null && !Array.isArray(compute)
      ? compute as Record<string, unknown>
      : {}
    const user = await prisma.user.findUnique({
      where: { id: generation.userId },
      select: { subscriptionTier: true, role: true },
    })
    logger.info(
      {
        event:                'generation.completed',
        jobId:                job.job_id,
        userId:               generation.userId,
        tier:                 user?.subscriptionTier ?? null,
        role:                 user?.role ?? null,
        quotaConsumed:        1,
        operation:            job.operation,
        engine:               job.result?.engine ?? null,
        mode:                 job.result?.mode ?? null,
        audioDurationS:       job.result?.duration_s ?? null,
        processingTimeMs:     processingTimeMs ?? null,
        gpuSeconds:           readNumber(computeMetrics, 'gpu_seconds'),
        peakVramBytes:        readNumber(computeMetrics, 'peak_vram_bytes'),
        requestedDurationS:   metadata['requested_duration_s'] ?? null,
      },
      'Generación completada',
    )
  }
}

// Sincroniza en segundo plano aunque el cliente deje de hacer polling.
// Se salta en tests para no dejar timers abiertos y no depende de la DB.
function watchGeneration(generation: GenerationRow, jobId: string): void {
  if (config.NODE_ENV === 'test') return

  const deadline = Date.now() + 24 * 60 * 60 * 1000
  const tick = async (): Promise<void> => {
    if (Date.now() > deadline) return
    try {
      const job = await musicLabClient.getJob(jobId)
      await syncGeneration(generation, job)
      if (job.status === 'succeeded' || job.status === 'failed') return
    } catch (error) {
      logger.warn({ jobId, error }, 'No se pudo sincronizar Generation en background')
    }
    const timer = setTimeout(() => void tick(), 5_000)
    timer.unref()
  }

  const timer = setTimeout(() => void tick(), 2_000)
  timer.unref()
}

async function startGeneration(
  userId: string,
  operation: 'generate' | 'repaint' | 'cover' | 'stems',
  params: Parameters<typeof musicLabClient.generate>[0],
): Promise<Record<string, unknown> & { generation_id: string }> {
  const quota = await consumeGenerationQuota(userId)

  try {
    const job = operation === 'generate'
      ? await musicLabClient.generate(params)
      : operation === 'repaint'
        ? await musicLabClient.repaint(params as Parameters<typeof musicLabClient.repaint>[0])
        : operation === 'cover'
          ? await musicLabClient.cover(params as Parameters<typeof musicLabClient.cover>[0])
          : await musicLabClient.stems(params as Parameters<typeof musicLabClient.stems>[0])

    let generationId: string
    try {
      generationId = await recordGeneration(userId, job.job_id, operation, params)
    } catch (error) {
      await refundGenerationQuota(userId)
      throw error
    }

    const generation = await getOwnedGeneration(job.job_id, userId)
    watchGeneration(generation, job.job_id)

    logger.info(
      {
        event:               'generation.accepted',
        jobId:               job.job_id,
        userId,
        operation,
        tier:                quota.tier,
        role:                quota.role,
        quotaConsumed:       1,
        quotaUsed:           quota.used,
        quotaLimit:          quota.limit,
        quotaUnlimited:      quota.unlimited,
        requestedDurationS:  params.duration_s ?? null,
        engine:              params.engine ?? null,
      },
      'Generación aceptada',
    )

    const encoded = encodeURIComponent(job.job_id)
    return {
      ...job,
      generation_id: generationId,
      job_url:   `/api/v1/music/jobs/${encoded}`,
      audio_url: `/api/v1/music/jobs/${encoded}/audio`,
    }
  } catch (error) {
    if (!(error instanceof Son1kverseError)) {
      await refundGenerationQuota(userId)
    }
    rethrowUpstream(error)
  }
}

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/music/health — salud del único motor de audio (público).
  app.get('/music/health', async (_req, reply) => {
    try {
      const health = await musicLabClient.health()
      return reply.status(health.status === 'ok' ? 200 : 503).send(successResponse(health))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(503).send({
        success: false,
        error: { code: 'MUSIC_LAB_UNAVAILABLE', message },
      })
    }
  })

  app.post('/music/generate', async (req, reply) => {
    const parsed = MusicLabGenerateSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    const job = await startGeneration(getAuthUserId(req), 'generate', parsed.data)
    return reply.status(202).send(successResponse(job))
  })

  app.post('/music/repaint', async (req, reply) => {
    const parsed = MusicLabRepaintSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    const job = await startGeneration(getAuthUserId(req), 'repaint', parsed.data)
    return reply.status(202).send(successResponse(job))
  })

  app.post('/music/cover', async (req, reply) => {
    const parsed = MusicLabCoverSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    const job = await startGeneration(getAuthUserId(req), 'cover', parsed.data)
    return reply.status(202).send(successResponse(job))
  })

  app.post('/music/stems', async (req, reply) => {
    const parsed = MusicLabStemsSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())
    const job = await startGeneration(getAuthUserId(req), 'stems', parsed.data)
    return reply.status(202).send(successResponse(job))
  })

  app.get('/music/jobs/:jobId', async (req, reply) => {
    const params = JobParamsSchema.safeParse(req.params)
    if (!params.success) throw new ValidationError(params.error.flatten())

    const userId = getAuthUserId(req)
    const generation = await getOwnedGeneration(params.data.jobId, userId)

    try {
      const job = await musicLabClient.getJob(params.data.jobId)
      await syncGeneration(generation, job)
      return reply.status(200).send(successResponse(job))
    } catch (error) {
      rethrowUpstream(error)
    }
  })

  app.get('/music/jobs/:jobId/audio', async (req, reply) => {
    const params = JobParamsSchema.safeParse(req.params)
    if (!params.success) throw new ValidationError(params.error.flatten())
    const query = AudioQuerySchema.safeParse(req.query)
    if (!query.success) throw new ValidationError(query.error.flatten())

    const userId = getAuthUserId(req)
    await getOwnedGeneration(params.data.jobId, userId)

    try {
      const stem: MusicLabStem | undefined = query.data.stem
      const audio = await musicLabClient.getAudio(params.data.jobId, stem)
      const fallbackName = audio.contentType.includes('mpeg')
        ? `${params.data.jobId}.mp3`
        : `${params.data.jobId}.wav`
      const filename = (audio.filename ?? fallbackName).replace(/["\r\n]/g, '')
      return reply
        .header('content-type', audio.contentType)
        .header('content-length', String(audio.buffer.byteLength))
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'private, max-age=0, no-store')
        .send(Buffer.from(audio.buffer))
    } catch (error) {
      rethrowUpstream(error)
    }
  })
}
