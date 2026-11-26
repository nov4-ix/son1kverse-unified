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
