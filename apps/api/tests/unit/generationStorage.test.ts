import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAudio: vi.fn(),
  putObject: vi.fn(),
  updateMany: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../../src/clients/musicLab.js', () => ({ musicLabClient: { getAudio: mocks.getAudio } }))
vi.mock('../../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/storage/client.js', () => ({
  prisma: { generation: { updateMany: mocks.updateMany } },
}))
vi.mock('../../src/storage/r2.js', () => ({
  r2: {
    isConfigured: () => true,
    bucket: 'son1k-audio',
    putObject: mocks.putObject,
    buildGenerationKey: (u: string, j: string, e: string) => `generations/${u}/${j}.${e}`,
  },
}))
vi.mock('../../src/services/StorageQuotaService.js', () => ({
  reserveStorageBytes: mocks.reserve,
  releaseStorageBytes: mocks.release,
}))

import { archiveGenerationAudio } from '../../src/services/GenerationStorageService.js'

function job(storage?: Record<string, unknown>): any {
  return {
    job_id: 'job1',
    status: 'succeeded',
    result: { audio_path: '/outputs/job1.wav', metadata: storage ? { storage } : {} },
  }
}
const uploaded = { backend: 'r2', status: 'uploaded', bucket: 'son1k-audio', key: 'generations/job1.wav', size_bytes: 1000 }

describe('archiveGenerationAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserve.mockResolvedValue(true)
    mocks.getAudio.mockResolvedValue({ buffer: new ArrayBuffer(10), contentType: 'audio/wav', filename: 'a.wav' })
  })

  it('usa la subida de Music Lab sin descargar ni volver a subir', async () => {
    await archiveGenerationAudio('u1', job(uploaded))
    expect(mocks.getAudio).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.reserve).toHaveBeenCalledWith('u1', 1000)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { externalJobId: 'job1', userId: 'u1' },
      data: { audioUrl: 'r2://son1k-audio/generations/job1.wav' },
    })
  })

  it('conserva el audio aunque la cuota de storage no alcance', async () => {
    mocks.reserve.mockResolvedValue(false)
    await archiveGenerationAudio('u1', job(uploaded))
    expect(mocks.updateMany).toHaveBeenCalledTimes(1)
  })

  it('si Music Lab no pudo subir, usa el respaldo: descarga y sube desde la API', async () => {
    await archiveGenerationAudio('u1', job({ backend: 'r2', status: 'failed', error: 'ConnectionError' }))
    expect(mocks.getAudio).toHaveBeenCalledTimes(1)
    expect(mocks.putObject).toHaveBeenCalledTimes(1)
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { audioUrl: 'r2://son1k-audio/generations/u1/job1.wav' } }),
    )
  })

  it('ignora una subida a otro bucket y usa el respaldo', async () => {
    await archiveGenerationAudio('u1', job({ ...uploaded, bucket: 'otro' }))
    expect(mocks.putObject).toHaveBeenCalledTimes(1)
  })

  it('sin bloque storage (R2 no configurado en Music Lab) usa el respaldo', async () => {
    await archiveGenerationAudio('u1', job())
    expect(mocks.putObject).toHaveBeenCalledTimes(1)
  })

  it('no hace nada si el job no terminó bien', async () => {
    await archiveGenerationAudio('u1', { ...job(uploaded), status: 'failed' })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
