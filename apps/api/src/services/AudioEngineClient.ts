// ─── SON1KVERSE — Audio Engine Client ─────────────────────────────────────────
// Cliente HTTP tipado para conectar el Backend TypeScript con el Audio Engine FastAPI.
// Incluye reintentos con backoff exponencial para soportar caídas temporales
// del motor Python (p. ej. reinicios en Windows, saturación de VRAM, etc.).

import { config } from '../config/index.js'

export interface AudioGenerateParams {
  genre:             string
  mood:              string
  language:          string
  duration_seconds:  number
  lyrics?:           string | null | undefined
  // Orquestación de Coherencia — fragmento de letra
  fragment_lyrics?:  string | null | undefined
  seed_audio_path?:  string | null | undefined
  fragment_index?:   number | null | undefined
  total_fragments?:  number | null | undefined
  is_coherent_song?: boolean | undefined
  bpm?:              number | null | undefined
  title?:            string | null | undefined
  structure?:        string[] | null | undefined
  skip_mastering?:   boolean | undefined
  skip_analysis?:    boolean | undefined
  // Estructura musical por sección (Fase 1 - Coherencia)
  section_name?:     string | null | undefined
  section_emotion?:  string | null | undefined
  section_energy?:   number | null | undefined

  // Selección de motor de generación (Fase 2 - ACE-Step)
  // 'heartmula' (por defecto) o 'ace_step' para base musical extrema velocidad
  engine:           'heartmula' | 'ace_step' | null | undefined
}

export interface AudioJobMetrics {
  quality_score?:         number
  production_ready?:      boolean
  lufs?:                  number
  spectral_centroid_hz?:  number
  spectral_bandwidth_hz?: number
}

export interface AudioJobResult {
  track_id:              string
  state:                 string
  success:               boolean
  // 'heartmula' | 'synthetic_fallback' — el backend no debe fingir que un
  // fallback sintético es una generación neuronal.
  engine_used?:          string | null
  raw_audio_path?:       string | null
  mastered_audio_path?:   string | null
  section_plan?:         unknown[] | null
  total_time_s:          number
  metrics?:              AudioJobMetrics | null
  error?:                string | null
}

export interface AudioJobStatus {
  track_id: string
  status:   'queued' | 'processing' | 'done' | 'error'
  result?:  AudioJobResult | null
  error?:   string | null
}

/**
 * Ejecuta una función fetch con reintentos y backoff exponencial.
 * Útil para soportar caídas transitorias del Audio Engine (Windows, VRAM, etc.).
 */
async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    retryableStatuses?: number[]
  } = {},
): Promise<Response> {
  const {
    maxRetries = 5,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    retryableStatuses = [408, 429, 500, 502, 503, 504],
  } = options

  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(input, init)

      // Si el status es retryable, lanzamos para entrar al catch y reintentar
      if (!res.ok && retryableStatuses.includes(res.status)) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text}`)
      }

      return res
    } catch (err) {
      lastError = err

      // Si es el último intento, lanzamos
      if (attempt >= maxRetries) {
        throw err
      }

      // Calcular delay con backoff exponencial + jitter
      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
      )

      console.warn(
        `[AudioEngineClient] Intento ${attempt + 1}/${maxRetries + 1} falló (${err instanceof Error ? err.message : String(err)}). Reintentando en ${Math.round(delay)}ms...`,
      )

      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw lastError
}

export class AudioEngineClient {
  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? config.AUDIO_ENGINE_API_URL).replace(/\/$/, '')
  }

  /**
   * Health check del Audio Engine FastAPI.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetchWithRetry(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      }, { maxRetries: 2, baseDelayMs: 1000 })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Encola la generación de audio en el Audio Engine de Python (HeartMuLa / DSP).
   */
  async generate(params: AudioGenerateParams): Promise<{ track_id: string; status: string; message: string }> {
    const res = await fetchWithRetry(`${this.baseUrl}/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
      // El motor encola y responde rápido; si no contesta en 30s, hay un problema.
      signal:  AbortSignal.timeout(30_000),
    }, { maxRetries: 3, baseDelayMs: 2000 })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AudioEngine /generate HTTP ${res.status}: ${text}`)
    }

    return (await res.json()) as { track_id: string; status: string; message: string }
  }

  /**
   * Consulta el estado de una tarea de generación.
   */
  async getStatus(trackId: string): Promise<AudioJobStatus> {
    const res = await fetchWithRetry(`${this.baseUrl}/status/${encodeURIComponent(trackId)}`, {
      signal: AbortSignal.timeout(10_000),
    }, { maxRetries: 5, baseDelayMs: 2000 })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AudioEngine /status/${trackId} HTTP ${res.status}: ${text}`)
    }
    return (await res.json()) as AudioJobStatus
  }

  /**
   * Retorna la URL de descarga directa del track WAV masterizado.
   */
  getDownloadUrl(trackId: string): string {
    return `${this.baseUrl}/download/${encodeURIComponent(trackId)}`
  }

  /**
   * Espera a que termine la generación mediante polling.
   * maxWaitMs por defecto = 8 horas (tiempo ilimitado para el cliente vía polling).
   * Reintenta automáticamente si el engine cae temporalmente.
   */
  async waitForCompletion(
    trackId: string,
    maxWaitMs = 8 * 60 * 60 * 1000,
    pollIntervalMs = 3_000,
  ): Promise<AudioJobStatus> {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      try {
        const job = await this.getStatus(trackId)
        if (job.status === 'done') {
          return job
        }
        if (job.status === 'error') {
          throw new Error(`Generación fallida para track ${trackId}: ${job.error ?? 'Error desconocido'}`)
        }
        // status === 'queued' o 'processing': seguir esperando
      } catch (err) {
        // Si el engine está caído, seguimos intentando hasta agotar maxWaitMs
        console.warn(
          `[AudioEngineClient] waitForCompletion(${trackId}) error (reintentando): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs))
    }
    throw new Error(`Timeout esperando que el track ${trackId} complete la generación`)
  }

  /**
   * Une varios WAV de fragmentos en una canción final mediante el endpoint
   * /concatenate del Audio Engine (crossfade entre bloques).
   * Devuelve el buffer del WAV final directamente.
   */
  async concatenate(
    paths: string[],
    outputName?: string,
  ): Promise<{ buffer: ArrayBuffer; filename: string }> {
    const res = await fetchWithRetry(`${this.baseUrl}/concatenate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ paths, output_name: outputName }),
      signal:  AbortSignal.timeout(300_000), // 5 min para concatenar
    }, { maxRetries: 3, baseDelayMs: 2000 })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AudioEngine /concatenate HTTP ${res.status}: ${text}`)
    }

    const buffer = await res.arrayBuffer()
    const cd = res.headers.get('content-disposition') ?? ''
    const m = cd.match(/filename="([^"]+)"/)
    const filename = m?.[1] ?? outputName ?? 'coherent_song.wav'
    return { buffer, filename }
  }
}

export const audioEngineClient = new AudioEngineClient()
