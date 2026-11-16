// ─── SON1KVERSE — Orchestrate Route ──────────────────────────────────────────

import type { FastifyInstance } from 'fastify'
import { OrchestrationRequestSchema, FeedbackSchema, successResponse } from '../../core/contracts.js'
import { ValidationError } from '../../core/errors.js'
import { Pixel } from '../../orchestration/Pixel.js'

const pixel = new Pixel()

// ─── Almacenamiento en memoria para jobs de canción coherente ───
interface CoherentJob {
  trackId: string
  status: 'queued' | 'processing' | 'done' | 'error'
  downloadUrl?: string
  error?: string
  fragments?: number
  createdAt: Date
}

const coherentJobStore = new Map<string, CoherentJob>()

export async function orchestrateRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/orchestrate — el flujo principal de Pixel
  app.post('/orchestrate', async (req, reply) => {
    const parsed = OrchestrationRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const result = await pixel.orchestrate(parsed.data)
    return reply.status(200).send(successResponse(result))
  })

  // POST /api/v1/orchestrate-coherent — canción completa por bloques coherentes (ASÍNCRONO)
  // Devuelve 202 inmediatamente con trackId. El cliente debe hacer polling en
  // GET /api/v1/coherent-status/:trackId hasta que status === 'done'.
  app.post('/orchestrate-coherent', async (req, reply) => {
    const parsed = OrchestrationRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const { prompt, lyrics, profileId, sessionId, options } = parsed.data
    const trackId = `coherent_${Date.now().toString(36)}`

    // Registrar job como queued
    coherentJobStore.set(trackId, {
      trackId,
      status: 'queued',
      createdAt: new Date(),
    })

    // Lanzar en background (no bloquear HTTP)
    void (async () => {
      try {
        coherentJobStore.get(trackId)!.status = 'processing'

        const result = await pixel.orchestrateCoherentSong({
          prompt,
          lyrics,
          profileId,
          sessionId,
          options,
          externalTrackId: trackId,
        })

        const content = typeof result.content === 'object' && result.content !== null
          ? result.content
          : {}
        coherentJobStore.get(trackId)!.status = 'done'
        coherentJobStore.get(trackId)!.downloadUrl = typeof content.download_url === 'string'
          ? content.download_url
          : `/api/v1/audio/download/${encodeURIComponent(trackId)}`
        coherentJobStore.get(trackId)!.fragments = typeof content.fragments === 'number'
          ? content.fragments
          : undefined
      } catch (err) {
        coherentJobStore.get(trackId)!.status = 'error'
        coherentJobStore.get(trackId)!.error = err instanceof Error ? err.message : String(err)
        console.error(`[Coherent] Job ${trackId} falló:`, err)
      }
    })()

    return reply.status(202).send(successResponse({
      trackId,
      status: 'queued',
      statusUrl: `/api/v1/coherent-status/${encodeURIComponent(trackId)}`,
      downloadUrl: `/api/v1/audio/download/${encodeURIComponent(trackId)}`,
    }))
  })

  // GET /api/v1/coherent-status/:trackId — estado de la canción coherente
  app.get('/coherent-status/:trackId', async (req, reply) => {
    const { trackId } = req.params as { trackId: string }
    if (!trackId) throw new ValidationError({ trackId: ['trackId es requerido'] })

    const job = coherentJobStore.get(trackId)
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Coherent job no encontrado' },
      })
    }

    return reply.status(200).send(successResponse({
      trackId: job.trackId,
      status: job.status,
      downloadUrl: job.downloadUrl,
      error: job.error,
      fragments: job.fragments,
    }))
  })

  // POST /api/v1/feedback — feedback del artista sobre un resultado
  app.post('/feedback', async (req, reply) => {
    const parsed = FeedbackSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    await pixel.processFeedback(parsed.data)
    return reply.status(200).send(successResponse({ ok: true }))
  })

  // ─── Rutas del Audio Engine (Python / HeartMuLa / DSP) ─────────────────────

  // POST /api/v1/audio/generate — encola generación de audio en el motor Python
  app.post('/audio/generate', async (req, reply) => {
    const { AudioGenerateRequestSchema } = await import('../../core/contracts.js')
    const { audioEngineClient } = await import('../../services/AudioEngineClient.js')

    const parsed = AudioGenerateRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const job = await audioEngineClient.generate({
      genre:            parsed.data.genre,
      mood:             parsed.data.mood,
      language:         parsed.data.language,
      duration_seconds: parsed.data.duration_seconds,
      lyrics:           parsed.data.lyrics,
      bpm:              parsed.data.bpm,
      title:            parsed.data.title,
      structure:        parsed.data.structure,
      skip_mastering:   parsed.data.skip_mastering,
      skip_analysis:    parsed.data.skip_analysis,
      section_name:     parsed.data.section_name,
      section_emotion:  parsed.data.section_emotion,
      section_energy:   parsed.data.section_energy,
      engine:           parsed.data.engine,
    })

    return reply.status(202).send(successResponse({
      ...job,
      download_url: `/api/v1/audio/download/${encodeURIComponent(job.track_id)}`,
      status_url: `/api/v1/audio/status/${encodeURIComponent(job.track_id)}`,
    }))
  })

  // GET /api/v1/audio/status/:trackId — consulta estado del track
  app.get('/audio/status/:trackId', async (req, reply) => {
    const { audioEngineClient } = await import('../../services/AudioEngineClient.js')
    const { trackId } = req.params as { trackId: string }
    if (!trackId) throw new ValidationError({ trackId: ['trackId es requerido'] })

    const status = await audioEngineClient.getStatus(trackId)
    return reply.status(200).send(successResponse({
      ...status,
      download_url: `/api/v1/audio/download/${encodeURIComponent(trackId)}`,
    }))
  })

  // GET /api/v1/audio/download/:trackId — proxy con JWT (el motor Python no se
  // expone directamente; la descarga pasa por Node y valida el token).
  app.get('/audio/download/:trackId', async (req, reply) => {
    const { audioEngineClient } = await import('../../services/AudioEngineClient.js')
    const { trackId } = req.params as { trackId: string }
    if (!trackId) throw new ValidationError({ trackId: ['trackId es requerido'] })

    const upstream = await fetch(audioEngineClient.getDownloadUrl(trackId), {
      signal: AbortSignal.timeout(60_000),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      return reply.status(upstream.status >= 500 ? 502 : upstream.status).send({
        success: false,
        error:   { code: 'DOWNLOAD_FAILED', message: text.slice(0, 500) },
      })
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    return reply
      .header('content-type',         upstream.headers.get('content-type') ?? 'audio/wav')
      .header('content-length',       String(buf.length))
      .header('content-disposition',  `attachment; filename="${trackId}.wav"`)
      .header('cache-control',        'private, max-age=0, no-store')
      .send(buf)
  })

  // GET /api/v1/audio/health — estado de salud del motor de audio Python
  app.get('/audio/health', async (_req, reply) => {
    const { audioEngineClient } = await import('../../services/AudioEngineClient.js')
    const isHealthy = await audioEngineClient.isHealthy()
    return reply.status(isHealthy ? 200 : 503).send(successResponse({
      healthy: isHealthy,
      service: 'HeartMuLa Audio Engine (Python)',
    }))
  })
}
