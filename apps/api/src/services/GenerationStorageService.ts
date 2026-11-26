// ─── Archivo de audio generado ──────────────────────────────────────────────
// Al completarse un job, sube el WAV/MP3 a R2 con clave usuario/job y deja en
// Generation.audioUrl un puntero `r2://bucket/key`. Si R2 no está configurado,
// la subida falla o la cuota de storage se agotó, se conserva el audio local y
// se avisa en logs: la generación ya se pagó y no debe perderse.

import type { MusicLabJob } from '../clients/musicLab.js'
import { musicLabClient } from '../clients/musicLab.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../storage/client.js'
import { r2 } from '../storage/r2.js'
import { releaseStorageBytes, reserveStorageBytes } from './StorageQuotaService.js'

let warnedMissingR2 = false

type PreUploaded = { bucket: string; key: string; sizeBytes: number }

// Music Lab sube el audio final a R2 antes de dar el job por terminado (el worker de
// GPU puede apagarse y su disco es efímero). Si lo logró, deja el puntero en metadata.
function preUploadedStorage(job: MusicLabJob): PreUploaded | null {
  const raw = job.result?.metadata?.['storage']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const storage = raw as Record<string, unknown>
  if (storage['backend'] !== 'r2' || storage['status'] !== 'uploaded') return null
  const bucket = storage['bucket']
  const key = storage['key']
  const size = storage['size_bytes']
  if (typeof bucket !== 'string' || typeof key !== 'string' || key === '') return null
  return { bucket, key, sizeBytes: typeof size === 'number' && size > 0 ? size : 0 }
}

function audioExtension(contentType: string, filename: string | null): 'mp3' | 'wav' {
  if (filename?.toLowerCase().endsWith('.mp3') || contentType.includes('mpeg')) {
    return 'mp3'
  }
  return 'wav'
}

export async function archiveGenerationAudio(
  userId: string,
  job: MusicLabJob,
): Promise<void> {
  if (job.status !== 'succeeded' || job.result === null || !('audio_path' in job.result)) {
    return
  }
  if (!r2.isConfigured()) {
    if (!warnedMissingR2) {
      warnedMissingR2 = true
      logger.warn(
        'R2 no configurado: los audios se quedan en Music Lab. Define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET para archivarlos.',
      )
    }
    return
  }

  const pre = preUploadedStorage(job)
  if (pre !== null && pre.bucket === r2.bucket) {
    // La generación ya se consumió y el objeto ya existe: se conserva aunque la cuota de
    // storage no alcance (se avisa en logs); perder un audio pagado es peor que excederla.
    const reserved = await reserveStorageBytes(userId, pre.sizeBytes)
    if (!reserved) {
      logger.warn(
        { event: 'storage.quota_exceeded_after_upload', jobId: job.job_id, userId, sizeBytes: pre.sizeBytes },
        'Cuota de storage agotada tras la subida de Music Lab: el audio se conserva igualmente',
      )
    }
    await prisma.generation.updateMany({
      where: { externalJobId: job.job_id, userId },
      data: { audioUrl: `r2://${r2.bucket}/${pre.key}` },
    })
    logger.info(
      { event: 'storage.archived', via: 'music-lab', jobId: job.job_id, userId, key: pre.key, sizeBytes: pre.sizeBytes },
      'Audio ya archivado en R2 por Music Lab',
    )
    return
  }

  let audio: Awaited<ReturnType<typeof musicLabClient.getAudio>>
  try {
    audio = await musicLabClient.getAudio(job.job_id)
  } catch (error) {
    logger.error(
      { event: 'storage.download_failed', jobId: job.job_id, error },
      'No se pudo descargar el audio de Music Lab para archivarlo',
    )
    return
  }

  const size = audio.buffer.byteLength
  const reserved = await reserveStorageBytes(userId, size)
  if (!reserved) {
    logger.warn(
      {
        event: 'storage.quota_exceeded',
        jobId: job.job_id,
        userId,
        sizeBytes: size,
      },
      'Cuota de storage agotada: el audio se queda en almacenamiento local',
    )
    return
  }

  const key = r2.buildGenerationKey(
    userId,
    job.job_id,
    audioExtension(audio.contentType, audio.filename),
  )
  try {
    await r2.putObject(key, new Uint8Array(audio.buffer), audio.contentType)
  } catch (error) {
    await releaseStorageBytes(userId, size)
    logger.error(
      { event: 'storage.upload_failed', jobId: job.job_id, userId, key, error },
      'Falló la subida a R2: el audio se queda en almacenamiento local',
    )
    return
  }

  await prisma.generation.updateMany({
    where: { externalJobId: job.job_id, userId },
    data: { audioUrl: `r2://${r2.bucket}/${key}` },
  })
  logger.info(
    {
      event: 'storage.archived',
      jobId: job.job_id,
      userId,
      key,
      sizeBytes: size,
    },
    'Audio archivado en R2',
  )
}
