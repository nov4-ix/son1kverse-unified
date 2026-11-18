import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const prismaMock = {
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  generation: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}

const musicLabMock = {
  generate: vi.fn(),
  repaint: vi.fn(),
  cover: vi.fn(),
  stems: vi.fn(),
  getJob: vi.fn(),
  getAudio: vi.fn(),
}

vi.mock('../../src/storage/client.js', () => ({ prisma: prismaMock }))
vi.mock('../../src/clients/musicLab.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/musicLab.js')>()
  return { ...actual, musicLabClient: musicLabMock }
})

const { buildServer } = await import('../../src/api/server.js')
const { syncGeneration } = await import('../../src/api/routes/music.js')

const job = {
  job_id: 'job-1',
  status: 'queued' as const,
  progress: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  request: { prompt: 'x', duration_s: 30 },
  result: null,
  error: null,
  queue_position: 0,
}

describe('auth global y cuota de música', () => {
  let app: FastifyInstance
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildServer()
    await app.ready()
    token = app.jwt.sign({ sub: 'user-1' })

    prismaMock.$queryRaw.mockResolvedValue([
      { generationsUsedThisMonth: 1, generationsLimit: 3, isAdmin: false },
    ])
    prismaMock.$executeRaw.mockResolvedValue(1)
    prismaMock.generation.create.mockResolvedValue({ id: 'gen-1' })
    prismaMock.generation.findUnique.mockResolvedValue({
      id: 'gen-1',
      userId: 'user-1',
      status: 'QUEUED',
      processingStartedAt: null,
      processingCompletedAt: null,
      processingTimeMs: null,
    })
    prismaMock.generation.update.mockResolvedValue({})
    musicLabMock.generate.mockResolvedValue(job)
  })

  afterEach(async () => {
    await app.close()
  })

  it('rechaza /music/generate sin JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      payload: { prompt: 'prueba' },
    })
    expect(response.statusCode).toBe(401)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('devuelve el contrato de error con details en validaciones', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: '' },
    })
    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toBeTruthy()
  })

  it('consume cuota y registra externalJobId con el userId del token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'prueba', duration_s: 30 },
    })

    expect(response.statusCode).toBe(202)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.generation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', externalJobId: 'job-1' }),
      }),
    )
    expect(response.json().data.generation_id).toBe('gen-1')
  })

  it('no entrega el job a otro usuario', async () => {
    prismaMock.generation.findUnique.mockResolvedValue({
      id: 'gen-1',
      userId: 'intruso',
      status: 'QUEUED',
      processingStartedAt: null,
      processingCompletedAt: null,
      processingTimeMs: null,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/music/jobs/job-1',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    expect(musicLabMock.getJob).not.toHaveBeenCalled()
  })

  it('devuelve la cuota cuando el job termina en failed', async () => {
    await syncGeneration(
      {
        id: 'gen-1',
        userId: 'user-1',
        status: 'PROCESSING',
        processingStartedAt: new Date(),
        processingCompletedAt: null,
        processingTimeMs: null,
      },
      { ...job, status: 'failed', error: { code: 'BOOM', message: 'falló' } },
    )

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
  })
})
