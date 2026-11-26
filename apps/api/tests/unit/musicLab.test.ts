import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/config/index.js', () => ({
  config: {
    MUSIC_LAB_URL: 'http://music-lab-standard.test',
    MUSIC_LAB_XL_URL: 'http://music-lab-xl.test',
    MUSIC_LAB_API_KEY: '',
    MUSIC_LAB_TIMEOUT_MS: 1_000,
    MUSIC_LAB_RETRIES: 1,
    MUSIC_LAB_RETRY_BACKOFF_MS: 100,
  },
}))

import {
  getMusicLabClient,
  MusicLabClient,
  musicLabClient,
  musicLabXlClient,
} from '../../src/clients/musicLab.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function client(retries = 1): MusicLabClient {
  return new MusicLabClient({
    baseUrl: 'http://music-lab.test',
    apiKey: '',
    timeoutMs: 1_000,
    retries,
    retryBackoffMs: 100,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MusicLabClient', () => {
  it('reintenta GET idempotentes ante 503', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    const health = await client().health()

    expect(health.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no reintenta POST para no duplicar jobs ni cuota', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(client().generate({ prompt: 'x' })).rejects.toMatchObject({
      code: 'MUSIC_LAB_ERROR',
      status: 503,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('agota reintentos y devuelve el último estado HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 'DOWN' }, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(client(2).health()).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('mapea fallos de red al contrato MUSIC_LAB_UNREACHABLE', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(client(1).health()).rejects.toMatchObject({
      code: 'MUSIC_LAB_UNREACHABLE',
      status: 502,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('selecciona el cliente estándar para turbo y el cliente XL para xl_turbo', () => {
    expect(musicLabClient.targetUrl).toBe('http://music-lab-standard.test')
    expect(musicLabXlClient.targetUrl).toBe('http://music-lab-xl.test')
    expect(getMusicLabClient()).toBe(musicLabClient)
    expect(getMusicLabClient(null)).toBe(musicLabClient)
    expect(getMusicLabClient('turbo')).toBe(musicLabClient)
    expect(getMusicLabClient('xl_turbo')).toBe(musicLabXlClient)
  })

  it('hace fallback a MUSIC_LAB_URL cuando baseUrl está vacío', () => {
    const fallbackClient = new MusicLabClient({ baseUrl: '   ' })
    expect(fallbackClient.targetUrl).toBe('http://music-lab-standard.test')
  })
})
