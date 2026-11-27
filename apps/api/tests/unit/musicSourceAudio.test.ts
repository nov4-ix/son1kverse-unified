import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE_ID = 'clx0source0000000000000001'
const FOREIGN_SOURCE_ID = 'clx0source0000000000000002'
const PENDING_SOURCE_ID = 'clx0source0000000000000003'
const MISSING_SOURCE_ID = 'clx0source0000000000000004'

const mocks = vi.hoisted(() => {
  const sourceRows = new Map<string, Record<string, unknown>>()
  const newRows = new Map<string, Record<string, unknown>>()
  const sourceJobs = new Map<string, Record<string, unknown>>()

  const findUnique = vi.fn(async (args: { where: Record<string, string> }) => {
    if (typeof args.where['id'] === 'string') return sourceRows.get(args.where['id']) ?? null
    if (typeof args.where['externalJobId'] === 'string') return newRows.get(args.where['externalJobId']) ?? null
    return null
  })
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const id = 'clx0newgeneration000000001'
    const externalJobId = String(args.data['externalJobId'])
    newRows.set(externalJobId, {
      ...args.data,
      id,
      status: 'QUEUED',
      processingStartedAt: null,
      processingCompletedAt: null,
      processingTimeMs: null,
      audioUrl: null,
    })
    return { id }
  })
  const userFindUnique = vi.fn(async () => ({ subscriptionTier: 'FREE' }))

  const getJob = vi.fn(async (jobId: string) => sourceJobs.get(jobId) ?? null)
  const repaint = vi.fn(async () => ({ job_id: 'job-repaint', status: 'queued', status_url: '/v1/jobs/job-repaint' }))
  const cover = vi.fn(async () => ({ job_id: 'job-cover', status: 'queued', status_url: '/v1/jobs/job-cover' }))
  const stems = vi.fn(async () => ({ job_id: 'job-stems', status: 'queued', status_url: '/v1/jobs/job-stems' }))
  const generate = vi.fn(async () => ({ job_id: 'job-generate', status: 'queued', status_url: '/v1/jobs/job-generate' }))

  const client = {
    targetUrl: 'http://music-lab.test',
    getJob,
    repaint,
    cover,
    stems,
    generate,
  }

  return {
    sourceRows,
    newRows,
    sourceJobs,
    findUnique,
    create,
    userFindUnique,
    getJob,
    repaint,
    cover,
    stems,
    generate,
    client,
  }
})

vi.mock('../../src/config/index.js', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
    ADMIN_UNLIMITED: true,
    MUSIC_LAB_URL: 'http://music-lab.test',
    MUSIC_LAB_XL_URL: 'http://music-lab.test',
    MUSIC_LAB_API_KEY: '',
    MUSIC_LAB_TIMEOUT_MS: 5_000,
    MUSIC_LAB_RETRIES: 0,
    MUSIC_LAB_RETRY_BACKOFF_MS: 100,
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    R2_BUCKET: undefined,
    R2_KEY_PREFIX: 'generations',
    R2_SIGNED_URL_TTL_SECONDS: 3_600,
    LOG_LEVEL: 'error',
    SYSTEM_VERSION: '0.1.0',
  },
}))

vi.mock('../../src/storage/client.js', () => ({
  prisma: {
    generation: {
      findUnique: mocks.findUnique,
      create: mocks.create,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: { findUnique: mocks.userFindUnique },
  },
}))

vi.mock('../../src/clients/musicLab.js', () => {
  class MusicLabClientError extends Error {
    readonly code: string
    readonly status: number
    readonly details: Record<string, unknown>
    constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
      super(message)
      this.code = code
      this.status = status
      this.details = details
    }
  }
  return {
    MusicLabClientError,
    musicLabClient: mocks.client,
    musicLabXlClient: mocks.client,
    getMusicLabClient: vi.fn(() => mocks.client),
  }
})

vi.mock('../../src/services/QuotaService.js', () => ({
  consumeGenerationQuota: vi.fn(async () => ({
    used: 1,
    limit: 3,
    unlimited: false,
    tier: 'FREE',
    role: 'USER',
  })),
  refundGenerationQuota: vi.fn(async () => undefined),
}))

vi.mock('../../src/services/GenerationStorageService.js', () => ({
  archiveGenerationAudio: vi.fn(async () => undefined),
}))

vi.mock('../../src/storage/r2.js', () => ({
  r2: {
    isConfigured: () => false,
    bucket: 'bucket',
    signedGetUrl: vi.fn(),
    buildGenerationKey: vi.fn(),
    putObject: vi.fn(),
  },
  r2KeyFromAudioUrl: () => null,
}))

import { errorHandlerPlugin } from '../../src/api/plugins/error-handler.js'
import { musicRoutes } from '../../src/api/routes/music.js'

async function createTestApp() {
  const app = Fastify()
  await app.register(fjwt, { secret: 'test-jwt-secret-with-at-least-32-characters' })
  await errorHandlerPlugin(app)
  app.addHook('preHandler', async (request) => {
    await request.jwtVerify()
  })
  await app.register(musicRoutes, { prefix: '/api/v1' })
  return app
}

function sourceRow(id: string, userId: string, status = 'COMPLETED') {
  return {
    id,
    userId,
    status,
    externalJobId: `job-${id}`,
    qualityPreset: 'turbo',
    modelVersion: 'turbo',
  }
}

function sourceJob(id: string) {
  return {
    job_id: `job-${id}`,
    operation: 'generate',
    status: 'succeeded',
    engine: 'simulation',
    mode: 'simulation',
    result: {
      job_id: `job-${id}`,
      audio_path: `/outputs/${id}.wav`,
      duration_s: 12,
      sample_rate: 48000,
      engine: 'simulation',
      mode: 'simulation',
      output_format: 'wav',
      metadata: {},
    },
    error: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function tokenFor(app: Awaited<ReturnType<typeof createTestApp>>, userId: string) {
  return app.jwt.sign({ sub: userId, alias: 'tester', email: 'tester@example.com' })
}

beforeEach(() => {
  mocks.sourceRows.clear()
  mocks.newRows.clear()
  mocks.sourceJobs.clear()
  vi.clearAllMocks()

  mocks.sourceRows.set(SOURCE_ID, sourceRow(SOURCE_ID, 'user-a'))
  mocks.sourceRows.set(FOREIGN_SOURCE_ID, sourceRow(FOREIGN_SOURCE_ID, 'user-b'))
  mocks.sourceRows.set(PENDING_SOURCE_ID, sourceRow(PENDING_SOURCE_ID, 'user-a', 'PROCESSING'))
  mocks.sourceJobs.set(`job-${SOURCE_ID}`, sourceJob(SOURCE_ID))
  mocks.sourceJobs.set(`job-${FOREIGN_SOURCE_ID}`, sourceJob(FOREIGN_SOURCE_ID))
})

describe('source_audio_path resuelto desde una Generation propia', () => {
  it('repaint usa el audio_path del job fuente y no acepta el path del body', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/repaint',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: {
          prompt: 'Repintar',
          source_generation_id: SOURCE_ID,
          start_s: 0,
          end_s: 4,
        },
      })

      expect(res.statusCode).toBe(202)
      expect(mocks.repaint).toHaveBeenCalledTimes(1)
      const params = mocks.repaint.mock.calls[0]?.[0] as Record<string, unknown>
      expect(params['source_audio_path']).toBe(`/outputs/${SOURCE_ID}.wav`)
      expect(params['source_generation_id']).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('rechaza una generación fuente de otro usuario', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/repaint',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: {
          prompt: 'Repintar',
          source_generation_id: FOREIGN_SOURCE_ID,
          start_s: 0,
          end_s: 4,
        },
      })

      expect(res.statusCode).toBe(403)
      expect(mocks.repaint).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('rechaza una generación fuente inexistente', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/cover',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: {
          prompt: 'Cover',
          source_generation_id: MISSING_SOURCE_ID,
        },
      })

      expect(res.statusCode).toBe(404)
      expect(mocks.cover).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('rechaza una generación fuente que todavía no terminó', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/cover',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: {
          prompt: 'Cover',
          source_generation_id: PENDING_SOURCE_ID,
        },
      })

      expect(res.statusCode).toBe(400)
      expect(mocks.cover).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('rechaza el body si todavía envía source_audio_path', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/repaint',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: {
          prompt: 'Repintar',
          source_audio_path: '/etc/passwd',
          start_s: 0,
          end_s: 4,
        },
      })

      expect(res.statusCode).toBe(400)
      expect(mocks.repaint).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('stems sin fuente explícita no resuelve ningún path', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/music/stems',
        headers: { authorization: `Bearer ${tokenFor(app, 'user-a')}` },
        payload: { prompt: 'Stems' },
      })

      expect(res.statusCode).toBe(202)
      expect(mocks.stems).toHaveBeenCalledTimes(1)
      const params = mocks.stems.mock.calls[0]?.[0] as Record<string, unknown>
      expect(params['source_audio_path']).toBeUndefined()
    } finally {
      await app.close()
    }
  })
})
