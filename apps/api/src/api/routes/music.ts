// ─── SON1KVERSE — Music Lab Routes ───────────────────────────────────────────

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { successResponse } from '../../core/contracts.js'
import { Son1kverseError, ValidationError } from '../../core/errors.js'
import {
  MusicLabClientError,
  musicLabClient,
  type MusicLabStem,
} from '../../clients/musicLab.js'

const MusicLabStemSchema = z.enum(['drums', 'bass', 'other'])

const MusicLabGenerateSchema = z.object({
  prompt:               z.string().min(1).max(4000),
  lyrics:               z.string().max(20_000).nullable().optional(),
  duration_s:           z.number().gt(0).max(600).default(30),
  seed:                 z.number().int().min(0).max(2 ** 32 - 1).optional(),
  bpm:                  z.number().int().min(30).max(300).optional(),
  key:                  z.string().min(1).max(16).optional(),
  style_tags:           z.array(z.string()).max(32).optional(),
  reference_audio_path: z.string().nullable().optional(),
  output_format:        z.enum(['wav', 'mp3']).default('wav'),
  master:               z.boolean().default(false),
  engine:               z.enum(['simulation', 'ace-step', 'heartmula']).nullable().optional(),
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

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  app.post('/music/generate', async (req, reply) => {
    const parsed = MusicLabGenerateSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    try {
      const job = await musicLabClient.generate(parsed.data)
      const jobId = encodeURIComponent(job.job_id)
      return reply.status(202).send(successResponse({
        ...job,
        job_url:   `/api/v1/music/jobs/${jobId}`,
        audio_url: `/api/v1/music/jobs/${jobId}/audio`,
      }))
    } catch (error) {
      rethrowUpstream(error)
    }
  })

  app.post('/music/repaint', async (req, reply) => {
    const parsed = MusicLabRepaintSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    try {
      const job = await musicLabClient.repaint(parsed.data)
      const jobId = encodeURIComponent(job.job_id)
      return reply.status(202).send(successResponse({
        ...job,
        job_url:   `/api/v1/music/jobs/${jobId}`,
        audio_url: `/api/v1/music/jobs/${jobId}/audio`,
      }))
    } catch (error) {
      rethrowUpstream(error)
    }
  })

  app.post('/music/cover', async (req, reply) => {
    const parsed = MusicLabCoverSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    try {
      const job = await musicLabClient.cover(parsed.data)
      const jobId = encodeURIComponent(job.job_id)
      return reply.status(202).send(successResponse({
        ...job,
        job_url:   `/api/v1/music/jobs/${jobId}`,
        audio_url: `/api/v1/music/jobs/${jobId}/audio`,
      }))
    } catch (error) {
      rethrowUpstream(error)
    }
  })

  app.post('/music/stems', async (req, reply) => {
    const parsed = MusicLabStemsSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    try {
      const job = await musicLabClient.stems(parsed.data)
      const jobId = encodeURIComponent(job.job_id)
      return reply.status(202).send(successResponse({
        ...job,
        job_url:   `/api/v1/music/jobs/${jobId}`,
        audio_url: `/api/v1/music/jobs/${jobId}/audio`,
      }))
    } catch (error) {
      rethrowUpstream(error)
    }
  })

  app.get('/music/jobs/:jobId', async (req, reply) => {
    const params = JobParamsSchema.safeParse(req.params)
    if (!params.success) throw new ValidationError(params.error.flatten())

    try {
      const job = await musicLabClient.getJob(params.data.jobId)
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
