import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const PROFILE_ID = 'clx0profile000000000000000'
const OTHER_PROFILE_ID = 'clx0profile111111111111111'
const SESSION_ID = 'clx0session000000000000000'

const prismaMock = {
  artistProfile: {
    findUnique: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('../../src/storage/client.js', () => ({ prisma: prismaMock }))

const { buildServer } = await import('../../src/api/server.js')

const now = new Date('2026-01-01T00:00:00.000Z')

const activeSession = {
  id:        SESSION_ID,
  userId:    'user-1',
  profileId: PROFILE_ID,
  status:    'active',
  metadata:  null as string | null,
  createdAt: now,
  updatedAt: now,
}

describe('sesiones con ownership', () => {
  let app: FastifyInstance
  let token: string

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildServer()
    await app.ready()
    token = app.jwt.sign({ sub: 'user-1' })

    prismaMock.artistProfile.findUnique.mockResolvedValue({ userId: 'user-1' })
    prismaMock.session.create.mockResolvedValue({
      ...activeSession,
      metadata: '{"source":"test"}',
    })
    prismaMock.session.findUnique.mockResolvedValue(activeSession)
    prismaMock.session.update.mockResolvedValue({ ...activeSession, status: 'completed' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('rechaza crear una sesión sin JWT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { profileId: PROFILE_ID },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.session.create).not.toHaveBeenCalled()
  })

  it('crea la sesión con el userId del token e ignora el del body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        profileId: PROFILE_ID,
        userId: 'intruso',
        metadata: { source: 'test' },
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.session.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        profileId: PROFILE_ID,
        metadata: '{"source":"test"}',
      },
    })
    expect(response.json().data.metadata).toEqual({ source: 'test' })
  })

  it('no crea una sesión para un perfil ajeno', async () => {
    prismaMock.artistProfile.findUnique.mockResolvedValue({ userId: 'intruso' })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { profileId: PROFILE_ID },
    })

    expect(response.statusCode).toBe(403)
    expect(prismaMock.session.create).not.toHaveBeenCalled()
  })

  it('no devuelve una sesión ajena', async () => {
    prismaMock.session.findUnique.mockResolvedValue({ ...activeSession, userId: 'intruso' })

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${SESSION_ID}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
  })

  it('cierra una sesión propia', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/close`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.session.update).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      data:  { status: 'completed' },
    })
    expect(response.json().data).toEqual({ id: SESSION_ID, status: 'completed' })
  })

  it('no cierra una sesión ajena', async () => {
    prismaMock.session.findUnique.mockResolvedValue({ ...activeSession, userId: 'intruso' })

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${SESSION_ID}/close`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    expect(prismaMock.session.update).not.toHaveBeenCalled()
  })

  it('orchestrate rechaza una sesión ajena antes de ejecutar Pixel', async () => {
    prismaMock.session.findUnique.mockResolvedValue({ ...activeSession, userId: 'intruso' })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrate',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'una canción', profileId: PROFILE_ID, sessionId: SESSION_ID },
    })

    expect(response.statusCode).toBe(403)
  })

  it('orchestrate rechaza una sesión de otro perfil', async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      ...activeSession,
      profileId: OTHER_PROFILE_ID,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrate',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'una canción', profileId: PROFILE_ID, sessionId: SESSION_ID },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('orchestrate-coherent exige letra aprobada antes de tocar la sesión', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrate-coherent',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'una canción', profileId: PROFILE_ID, sessionId: SESSION_ID },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    expect(prismaMock.session.findUnique).not.toHaveBeenCalled()
  })

  it('orchestrate rechaza una sesión cerrada', async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      ...activeSession,
      status: 'completed',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/orchestrate',
      headers: { authorization: `Bearer ${token}` },
      payload: { prompt: 'una canción', profileId: PROFILE_ID, sessionId: SESSION_ID },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('SESSION_NOT_ACTIVE')
  })
})
