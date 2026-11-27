import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationStatus } from '@son1k/db'

type StoredGeneration = {
  id: string
  userId: string
  externalJobId: string | null
  prompt: string
  status: GenerationStatus
  qualityPreset: string | null
  modelVersion: string | null
  duration: number
  tempo: number | null
  key: string | null
  audioUrl: string | null
  createdAt: Date
}

const state = vi.hoisted(() => {
  process.env['NODE_ENV'] = 'test'
  process.env['JWT_SECRET'] ??= 'test-secret-0123456789-0123456789-abcdef'
  return {
    generations: [] as StoredGeneration[],
    capabilities: {
      service: 'son1kverse-music-lab',
      default_mode: 'auto',
      active_engine: 'ace-step' as 'simulation' | 'ace-step' | null,
      modes: ['simulation', 'ace-step', 'auto'],
      engines: ['simulation', 'ace-step'] as Array<'simulation' | 'ace-step'>,
      methods: ['cover', 'generate', 'repaint', 'stems'],
      output_formats: ['wav', 'mp3'] as Array<'wav' | 'mp3'>,
      max_concurrency: 1,
    },
  }
})

const { findManyMock, countMock } = vi.hoisted(() => {
const findManyMock = vi.fn(async (args?: {
  where?: { userId?: string }
  take?: number
  skip?: number
}) => {
  const userId = args?.where?.userId
  const filtered = state.generations
    .filter((row) => (userId === undefined ? true : row.userId === userId))
    .slice()
    .sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      return timeDiff !== 0 ? timeDiff : b.id.localeCompare(a.id)
    })
  const skip = args?.skip ?? 0
  const take = args?.take ?? filtered.length
  return filtered.slice(skip, skip + take)
})

const countMock = vi.fn(async (args?: { where?: { userId?: string } }) => {
  const userId = args?.where?.userId
  return state.generations.filter((row) => (userId === undefined ? true : row.userId === userId)).length
})

  return { findManyMock, countMock }
})

vi.mock('../src/storage/client.js', () => ({
  prisma: {
    generation: {
      findMany: findManyMock,
      count: countMock,
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}))

vi.mock('../src/clients/musicLab.js', () => {
  class MockMusicLabClientError extends Error {
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
  const client = {
    targetUrl: 'http://127.0.0.1:8002',
    health: vi.fn(async () => ({
      status: 'ok',
      service: 'son1kverse-music-lab',
      version: '0.1.0',
      mode: 'simulation',
      engine: null,
      reason: null,
    })),
    capabilities: vi.fn(async () => state.capabilities),
  }
  return {
    MusicLabClient: vi.fn(),
    MusicLabClientError: MockMusicLabClientError,
    musicLabClient: client,
    musicLabXlClient: client,
    getMusicLabClient: vi.fn(() => client),
  }
})

import { buildServer } from '../src/api/server.js'

function makeGeneration(overrides: Partial<StoredGeneration> & { id: string; userId: string }): StoredGeneration {
  return {
    externalJobId: `job-${overrides.id}`,
    prompt: `Prompt ${overrides.id}`,
    status: GenerationStatus.COMPLETED,
    qualityPreset: 'turbo',
    modelVersion: 'turbo',
    duration: 180,
    tempo: 120,
    key: 'Dm',
    audioUrl: `/tmp/${overrides.id}.wav`,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    ...overrides,
  }
}

describe('GET /api/v1/music/generations', () => {
  beforeEach(() => {
    state.generations = []
    findManyMock.mockClear()
    countMock.mockClear()
  })

  it('exige JWT válido', async () => {
    const app = await buildServer()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/music/generations' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('filtra estrictamente por userId del JWT y ordena por createdAt descendente', async () => {
    state.generations = [
      makeGeneration({
        id: 'gen-a1',
        userId: 'user-a',
        externalJobId: 'job-a1',
        prompt: 'Primera canción de A',
        status: GenerationStatus.COMPLETED,
        qualityPreset: 'turbo',
        modelVersion: 'ace-step',
        duration: 165,
        tempo: 112,
        key: 'Am',
        audioUrl: 'r2://bucket/generations/user-a/job-a1.wav',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      }),
      makeGeneration({
        id: 'gen-b1',
        userId: 'user-b',
        externalJobId: 'job-b1',
        prompt: 'Canción privada de B',
        status: GenerationStatus.COMPLETED,
        qualityPreset: 'xl_turbo',
        createdAt: new Date('2026-06-01T11:00:00.000Z'),
      }),
      makeGeneration({
        id: 'gen-a2',
        userId: 'user-a',
        externalJobId: 'job-a2',
        prompt: 'Segunda canción de A',
        status: GenerationStatus.PROCESSING,
        qualityPreset: 'xl_turbo',
        modelVersion: 'xl_turbo',
        duration: 190,
        tempo: 128,
        key: 'Cm',
        audioUrl: null,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
      }),
    ]

    const app = await buildServer()
    try {
      const tokenA = app.jwt.sign({ sub: 'user-a', alias: 'alice', email: 'a@example.com' })
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/music/generations?userId=user-b',
        headers: { authorization: `Bearer ${tokenA}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.success).toBe(true)
      expect(body.data.total).toBe(2)
      expect(body.data.items).toHaveLength(2)
      expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(['gen-a2', 'gen-a1'])
      expect(body.data.items[0]).toEqual({
        id: 'gen-a2',
        externalJobId: 'job-a2',
        prompt: 'Segunda canción de A',
        status: 'running',
        qualityPreset: 'xl_turbo',
        modelVersion: 'xl_turbo',
        durationS: 190,
        bpm: 128,
        musicalKey: 'Cm',
        audioUrl: null,
        createdAt: '2026-06-01T12:00:00.000Z',
      })
      expect(body.data.items[1]).toEqual({
        id: 'gen-a1',
        externalJobId: 'job-a1',
        prompt: 'Primera canción de A',
        status: 'completed',
        qualityPreset: 'turbo',
        modelVersion: 'ace-step',
        durationS: 165,
        bpm: 112,
        musicalKey: 'Am',
        audioUrl: '/api/v1/music/jobs/job-a1/audio',
        createdAt: '2026-06-01T10:00:00.000Z',
      })

      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-a' },
          take: 20,
          skip: 0,
        }),
      )
      expect(countMock).toHaveBeenCalledWith({ where: { userId: 'user-a' } })
    } finally {
      await app.close()
    }
  })

  it('pagina con limit y offset y valida parámetros inválidos', async () => {
    state.generations = [
      makeGeneration({ id: 'g1', userId: 'user-a', createdAt: new Date('2026-06-01T01:00:00.000Z') }),
      makeGeneration({ id: 'g2', userId: 'user-a', createdAt: new Date('2026-06-01T02:00:00.000Z') }),
      makeGeneration({ id: 'g3', userId: 'user-a', createdAt: new Date('2026-06-01T03:00:00.000Z') }),
      makeGeneration({ id: 'g4', userId: 'user-a', status: GenerationStatus.FAILED, audioUrl: null, createdAt: new Date('2026-06-01T04:00:00.000Z') }),
      makeGeneration({ id: 'other', userId: 'user-b', createdAt: new Date('2026-06-01T05:00:00.000Z') }),
    ]

    const app = await buildServer()
    try {
      const tokenA = app.jwt.sign({ sub: 'user-a', alias: 'alice', email: 'a@example.com' })

      const page1 = await app.inject({
        method: 'GET',
        url: '/api/v1/music/generations?limit=2&offset=1',
        headers: { authorization: `Bearer ${tokenA}` },
      })
      expect(page1.statusCode).toBe(200)
      expect(page1.json().data.items.map((item: { id: string }) => item.id)).toEqual(['g3', 'g2'])
      expect(page1.json().data.total).toBe(4)
      expect(page1.json().data.limit).toBe(2)
      expect(page1.json().data.offset).toBe(1)
      expect(page1.json().data.hasMore).toBe(true)

      const page2 = await app.inject({
        method: 'GET',
        url: '/api/v1/music/generations?limit=2&offset=2',
        headers: { authorization: `Bearer ${tokenA}` },
      })
      expect(page2.statusCode).toBe(200)
      expect(page2.json().data.items.map((item: { id: string }) => item.id)).toEqual(['g2', 'g1'])
      expect(page2.json().data.hasMore).toBe(false)

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/v1/music/generations?limit=0&offset=-1',
        headers: { authorization: `Bearer ${tokenA}` },
      })
      expect(invalid.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('expone /api/v1/music/capabilities indicando si el motor activo soporta stems', async () => {
    const app = await buildServer()
    try {
      state.capabilities.active_engine = 'ace-step'
      const aceRes = await app.inject({ method: 'GET', url: '/api/v1/music/capabilities' })
      expect(aceRes.statusCode).toBe(200)
      expect(aceRes.json().data.supports_stems).toBe(false)
      expect(aceRes.json().data.active_methods).not.toContain('stems')

      state.capabilities.active_engine = 'simulation'
      const simRes = await app.inject({ method: 'GET', url: '/api/v1/music/capabilities' })
      expect(simRes.statusCode).toBe(200)
      expect(simRes.json().data.supports_stems).toBe(true)
      expect(simRes.json().data.active_methods).toContain('stems')
    } finally {
      await app.close()
    }
  })
})
