import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENTERPRISE_GENERATIONS_PER_MONTH,
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTION_PLANS,
  allowedQualityPresetsForTier,
  isUnlimitedTier,
} from '@son1k/shared-types'

const STANDARD_URL = 'http://music-lab-standard.test'
const XL_URL = 'http://music-lab-xl.test'

type MockUserRow = {
  id: string
  subscriptionTier: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'
  role: 'USER' | 'PRO' | 'ADMIN' | 'MODERATOR'
  generationsUsedThisMonth: number
  generationsLimit: number
}

type MockGenerationRow = {
  id: string
  userId: string
  externalJobId: string
  status: string
  qualityPreset: string | null
  modelVersion: string | null
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingTimeMs: number | null
  audioUrl: string | null
}

const mockUsers = new Map<string, MockUserRow>()
const mockGenerations = new Map<string, MockGenerationRow>()
let quotaConsumeCalls = 0
let generationSeq = 0

vi.mock('../../src/config/index.js', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
    ADMIN_UNLIMITED: true,
    MUSIC_LAB_URL: 'http://music-lab-standard.test',
    MUSIC_LAB_XL_URL: 'http://music-lab-xl.test',
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
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = mockUsers.get(where.id)
        if (!user) return null
        return {
          subscriptionTier: user.subscriptionTier,
          generationsLimit: user.generationsLimit,
          role: user.role,
        }
      }),
    },
    generation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        generationSeq += 1
        const id = `gen_${generationSeq}`
        const externalJobId = String(data['externalJobId'])
        const row: MockGenerationRow = {
          id,
          userId: String(data['userId']),
          externalJobId,
          status: String(data['status']),
          qualityPreset: (data['qualityPreset'] as string | null) ?? null,
          modelVersion: (data['modelVersion'] as string | null) ?? null,
          processingStartedAt: null,
          processingCompletedAt: null,
          processingTimeMs: null,
          audioUrl: null,
        }
        mockGenerations.set(externalJobId, row)
        return { id }
      }),
      findUnique: vi.fn(async ({ where }: { where: { externalJobId: string } }) => {
        return mockGenerations.get(where.externalJobId) ?? null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const row of mockGenerations.values()) {
          if (row.id === where.id) {
            Object.assign(row, data)
            return row
          }
        }
        return null
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const row of mockGenerations.values()) {
          if (row.id === where.id) {
            Object.assign(row, data)
            return { count: 1 }
          }
        }
        return { count: 0 }
      }),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ')
      if (!sql.includes('UPDATE "User"')) return []
      quotaConsumeCalls += 1
      // En QuotaService.ts: WHERE "id" = ${userId} AND (${config.ADMIN_UNLIMITED} ...)
      const userId = String(values[0])
      const user = mockUsers.get(userId)
      if (!user) return []
      if (user.generationsUsedThisMonth >= user.generationsLimit) return []
      user.generationsUsedThisMonth += 1
      return [
        {
          generationsUsedThisMonth: user.generationsUsedThisMonth,
          generationsLimit: user.generationsLimit,
          isAdmin: user.role === 'ADMIN',
          tier: user.subscriptionTier,
          role: user.role,
        },
      ]
    }),
    $executeRaw: vi.fn(async () => 1),
  },
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  mockUsers.clear()
  mockGenerations.clear()
  quotaConsumeCalls = 0
  generationSeq = 0

  mockUsers.set('user_free', {
    id: 'user_free',
    subscriptionTier: 'FREE',
    role: 'USER',
    generationsUsedThisMonth: 0,
    generationsLimit: 3,
  })
  mockUsers.set('user_starter', {
    id: 'user_starter',
    subscriptionTier: 'STARTER',
    role: 'USER',
    generationsUsedThisMonth: 0,
    generationsLimit: 100,
  })
  mockUsers.set('user_pro', {
    id: 'user_pro',
    subscriptionTier: 'PRO',
    role: 'USER',
    generationsUsedThisMonth: 0,
    generationsLimit: 500,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Reglas por SubscriptionTier (shared-types)', () => {
  it('restringe FREE a turbo y habilita turbo + xl_turbo en planes pagos', () => {
    expect(allowedQualityPresetsForTier('FREE')).toEqual(['turbo'])
    expect(allowedQualityPresetsForTier('STARTER')).toEqual(['turbo', 'xl_turbo'])
    expect(allowedQualityPresetsForTier('PRO')).toEqual(['turbo', 'xl_turbo'])
    expect(allowedQualityPresetsForTier('ENTERPRISE')).toEqual(['turbo', 'xl_turbo'])

    const freePlan = SUBSCRIPTION_PLANS.find((plan) => plan.tier === 'FREE')
    const proPlan = SUBSCRIPTION_PLANS.find((plan) => plan.tier === 'PRO')
    expect(freePlan?.allowedQualityPresets).toEqual(['turbo'])
    expect(proPlan?.allowedQualityPresets).toEqual(['turbo', 'xl_turbo'])
  })

  it('reemplaza el cupo ilimitado en ENTERPRISE por un tope mensual finito de 5000', () => {
    expect(ENTERPRISE_GENERATIONS_PER_MONTH).toBe(5_000)
    expect(SUBSCRIPTION_LIMITS.ENTERPRISE.generationsPerMonth).toBe(5_000)
    expect(isUnlimitedTier('ENTERPRISE')).toBe(false)
  })
})

describe('Enrutamiento y validación por tier en /api/v1/music', () => {
  it('usuario FREE sin quality_preset usa turbo por defecto y enruta a MUSIC_LAB_URL', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ job_id: 'job_free_1', status: 'queued', status_url: '/v1/jobs/job_free_1' }, 202),
    )
    vi.stubGlobal('fetch', fetchMock)

    const app = await createTestApp()
    const token = app.jwt.sign({ sub: 'user_free', alias: 'free', email: 'free@test.local' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      remoteAddress: '10.0.0.1',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'synthwave nocturno' },
    })

    expect(res.statusCode).toBe(202)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe(`${STANDARD_URL}/v1/generate`)
    expect(JSON.parse(init.body)).toMatchObject({ quality_preset: 'turbo' })

    const saved = mockGenerations.get('job_free_1')
    expect(saved?.qualityPreset).toBe('turbo')
    expect(quotaConsumeCalls).toBe(1)

    await app.close()
  })

  it('usuario FREE recibe 403 al solicitar xl_turbo sin consumir cuota ni llamar a Music Lab', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const app = await createTestApp()
    const token = app.jwt.sign({ sub: 'user_free', alias: 'free', email: 'free@test.local' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      remoteAddress: '10.0.0.2',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'synthwave nocturno', quality_preset: 'xl_turbo' },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json() as { success: boolean; error: { code: string; details: Record<string, unknown> } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('TIER_UPGRADE_REQUIRED')
    expect(body.error.details).toMatchObject({
      quality_preset: 'xl_turbo',
      subscription_tier: 'FREE',
      allowed_presets: ['turbo'],
    })
    expect(quotaConsumeCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()

    await app.close()
  })

  it('usuario pago (STARTER/PRO) con xl_turbo enruta POST, GET job y GET audio a MUSIC_LAB_XL_URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/v1/generate')) {
        return jsonResponse({ job_id: 'job_xl_1', status: 'queued', status_url: '/v1/jobs/job_xl_1' }, 202)
      }
      if (url.endsWith('/v1/jobs/job_xl_1')) {
        return jsonResponse({
          job_id: 'job_xl_1',
          operation: 'generate',
          status: 'succeeded',
          engine: 'ace-step',
          mode: 'ace-step',
          result: {
            job_id: 'job_xl_1',
            audio_path: '/outputs/xl/job_xl_1.wav',
            duration_s: 30,
            sample_rate: 44100,
            engine: 'ace-step',
            mode: 'ace-step',
            output_format: 'wav',
            metadata: {},
          },
          error: null,
          created_at: '2026-11-26T12:00:00Z',
          updated_at: '2026-11-26T12:00:10Z',
        })
      }
      if (url.endsWith('/v1/jobs/job_xl_1/audio')) {
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: {
            'content-type': 'audio/wav',
            'content-disposition': 'attachment; filename="job_xl_1.wav"',
          },
        })
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)

    const app = await createTestApp()
    const token = app.jwt.sign({ sub: 'user_pro', alias: 'pro', email: 'pro@test.local' })

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      remoteAddress: '10.0.0.3',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'orquesta cyberpunk', quality_preset: 'xl_turbo' },
    })

    expect(postRes.statusCode).toBe(202)
    expect(mockGenerations.get('job_xl_1')?.qualityPreset).toBe('xl_turbo')
    const [postUrl, postInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(postUrl).toBe(`${XL_URL}/v1/generate`)
    expect(JSON.parse(postInit.body)).toMatchObject({ quality_preset: 'xl_turbo' })

    const jobRes = await app.inject({
      method: 'GET',
      url: '/api/v1/music/jobs/job_xl_1',
      remoteAddress: '10.0.0.4',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(jobRes.statusCode).toBe(200)
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`${XL_URL}/v1/jobs/job_xl_1`)

    const audioRes = await app.inject({
      method: 'GET',
      url: '/api/v1/music/jobs/job_xl_1/audio',
      remoteAddress: '10.0.0.5',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(audioRes.statusCode).toBe(200)
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(`${XL_URL}/v1/jobs/job_xl_1/audio`)

    await app.close()
  })

  it('usuario STARTER sin quality_preset usa turbo por defecto y enruta a MUSIC_LAB_URL', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ job_id: 'job_starter_1', status: 'queued', status_url: '/v1/jobs/job_starter_1' }, 202),
    )
    vi.stubGlobal('fetch', fetchMock)

    const app = await createTestApp()
    const token = app.jwt.sign({ sub: 'user_starter', alias: 'starter', email: 'starter@test.local' })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/music/generate',
      remoteAddress: '10.0.0.6',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'indie pop cálido' },
    })

    expect(res.statusCode).toBe(202)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${STANDARD_URL}/v1/generate`)
    expect(mockGenerations.get('job_starter_1')?.qualityPreset).toBe('turbo')

    await app.close()
  })
})
