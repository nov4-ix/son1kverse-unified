import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['NODE_ENV'] = 'test'
process.env['JWT_SECRET'] = 'test-secret-0123456789-0123456789-abcdef'

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
  musicLabHealth: vi.fn(async () => ({ status: 'ok' })),
}))

vi.mock('../../src/config/index.js', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '127.0.0.1',
    CORS_ORIGINS: 'http://localhost:5173',
    ALLOW_ANON_DEV: false,
    ADMIN_UNLIMITED: true,
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'test-secret-0123456789-0123456789-abcdef',
    JWT_EXPIRES_IN: '7d',
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
    OPENAI_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined,
    OLLAMA_BASE_URL: 'http://localhost:11434',
    PIXEL_DEFAULT_MODEL: 'test',
    PIXEL_ANALYSIS_MODEL: 'test',
    EMBEDDING_MODEL: 'test',
    MAX_MEMORY_CONTEXT: 10,
    LOG_LEVEL: 'error',
    SYSTEM_VERSION: '0.1.0',
  },
}))

vi.mock('../../src/storage/client.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    generation: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn(async () => null) },
    refreshToken: { findUnique: vi.fn(async () => null), create: vi.fn(), deleteMany: vi.fn() },
  },
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
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
  const client = {
    targetUrl: 'http://music-lab.test',
    health: mocks.musicLabHealth,
    capabilities: vi.fn(),
    getJob: vi.fn(),
    getAudio: vi.fn(),
    generate: vi.fn(),
    repaint: vi.fn(),
    cover: vi.fn(),
    stems: vi.fn(),
  }
  return {
    MusicLabClientError,
    musicLabClient: client,
    musicLabXlClient: client,
    getMusicLabClient: vi.fn(() => client),
  }
})

import { buildServer } from '../../src/api/server.js'

let app: Awaited<ReturnType<typeof buildServer>> | null = null

beforeEach(() => {
  mocks.queryRaw.mockReset()
  mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }])
  mocks.musicLabHealth.mockReset()
  mocks.musicLabHealth.mockResolvedValue({ status: 'ok' })
})

afterEach(async () => {
  if (app !== null) {
    await app.close()
    app = null
  }
})

describe('GET /health y /ready', () => {
  it('responde 200 cuando Postgres y Music Lab están sanos', async () => {
    app = await buildServer()
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    const body = health.json()
    expect(body.status).toBe('ok')
    expect(body.checks.postgres.status).toBe('ok')
    expect(body.checks.musicLab.status).toBe('ok')

    const ready = await app.inject({ method: 'GET', url: '/ready' })
    expect(ready.statusCode).toBe(200)
    expect(ready.json().ready).toBe(true)
  })

  it('responde 503 si Postgres falla', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('db down'))
    app = await buildServer()
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(503)
    expect(health.json().checks.postgres.status).toBe('error')
    const ready = await app.inject({ method: 'GET', url: '/ready' })
    expect(ready.statusCode).toBe(503)
  })

  it('responde 503 si Music Lab falla', async () => {
    mocks.musicLabHealth.mockRejectedValue(new Error('lab down'))
    app = await buildServer()
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(503)
    expect(health.json().checks.musicLab.status).toBe('error')
  })
})
