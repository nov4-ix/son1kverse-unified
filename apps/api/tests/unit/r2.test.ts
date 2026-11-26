import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// r2.ts crea un singleton al importarse; se mockea la config para no exigir env real.
vi.mock('../../src/config/index.js', () => ({
  config: {
    R2_ACCOUNT_ID: 'acct123',
    R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    R2_BUCKET: 'son1k-audio',
    R2_KEY_PREFIX: 'generations',
    R2_SIGNED_URL_TTL_SECONDS: 3600,
  },
}))

import { R2Client, r2KeyFromAudioUrl } from '../../src/storage/r2.js'

// Valores de referencia generados con boto3/botocore (implementación independiente
// de AWS SigV4) a tiempo fijo 2026-11-25T12:00:00Z, region "auto", path-style.
// Si este test falla, la firma hecha a mano ya no coincide con la de AWS y R2
// rechazaría las subidas y las URLs firmadas.
const OPTIONS = {
  accountId: 'acct123',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'son1k-audio',
  keyPrefix: 'generations',
  signedUrlTtlSeconds: 3600,
}
const KEY = 'generations/user_1/job_1.wav'
const GOLDEN_GET_URL =
  'https://acct123.r2.cloudflarestorage.com/son1k-audio/generations/user_1/job_1.wav' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261125%2Fauto%2Fs3%2Faws4_request' +
  '&X-Amz-Date=20261125T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host' +
  '&X-Amz-Signature=86ceba870d1935fd63f49bbd72825e2810106868c62b02957b095fee9c8ba422'
const GOLDEN_PUT_AUTH =
  'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261125/auto/s3/aws4_request, ' +
  'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
  'Signature=c3590759922471693b8ab9037d4250acd70dfbe5d6496b22df9c7b52b48041c5'

describe('R2Client (firma SigV4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('genera una URL firmada idéntica a la de boto3', () => {
    const signed = new R2Client(OPTIONS).signedGetUrl(KEY, 3600)
    expect(signed.url).toBe(GOLDEN_GET_URL)
    expect(signed.expiresAt).toBe('2026-11-25T13:00:00.000Z')
  })

  it('limita el TTL entre 60 s y 7 días', () => {
    const client = new R2Client(OPTIONS)
    expect(client.signedGetUrl(KEY, 1).url).toContain('X-Amz-Expires=60&')
    expect(client.signedGetUrl(KEY, 99_999_999).url).toContain('X-Amz-Expires=604800&')
  })

  it('firma el PUT igual que boto3', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new R2Client(OPTIONS).putObject(KEY, new TextEncoder().encode('hello-audio'), 'audio/wav')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://acct123.r2.cloudflarestorage.com/son1k-audio/generations/user_1/job_1.wav')
    expect(init.headers.authorization).toBe(GOLDEN_PUT_AUTH)
  })

  it('lanza error legible si R2 responde mal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(
      new R2Client(OPTIONS).putObject(KEY, new Uint8Array([1]), 'audio/wav'),
    ).rejects.toThrow(/R2 PUT failed \(403\)/)
  })

  it('isConfigured es false si falta cualquier credencial', () => {
    expect(new R2Client(OPTIONS).isConfigured()).toBe(true)
    expect(new R2Client({ ...OPTIONS, secretAccessKey: '' }).isConfigured()).toBe(false)
    expect(new R2Client({ ...OPTIONS, bucket: '' }).isConfigured()).toBe(false)
  })

  it('sanea usuario y job al construir la clave', () => {
    const client = new R2Client(OPTIONS)
    expect(client.buildGenerationKey('u/../x', 'j 1', 'MP3')).toBe('generations/u____x/j_1.mp3')
    expect(client.buildGenerationKey('u', 'j', 'exe')).toBe('generations/u/j.wav')
  })

  it('r2KeyFromAudioUrl solo reconoce el esquema r2://<bucket>/', () => {
    expect(r2KeyFromAudioUrl('r2://son1k-audio/generations/u/j.wav')).toBe('generations/u/j.wav')
    expect(r2KeyFromAudioUrl('r2://otro-bucket/x.wav')).toBeNull()
    expect(r2KeyFromAudioUrl('/local/x.wav')).toBeNull()
    expect(r2KeyFromAudioUrl(null)).toBeNull()
  })
})
