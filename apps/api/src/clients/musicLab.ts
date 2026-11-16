// ─── SON1KVERSE — Music Lab Client ────────────────────────────────────────────
// Cliente HTTP tipado para el servicio FastAPI `services/music-lab`.
// Los tipos están escritos a mano y reflejan services/music-lab/openapi.json.

import { config } from '../config/index.js'

export type MusicLabEngine = 'simulation' | 'ace-step' | 'heartmula'
export type MusicLabOutputFormat = 'wav' | 'mp3'
export type MusicLabJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type MusicLabStem = 'drums' | 'bass' | 'other'
export type MusicLabOperation = 'generate' | 'repaint' | 'cover' | 'stems'

export interface MusicLabGenerateParams {
  prompt: string
  lyrics?: string | null | undefined
  duration_s?: number | undefined
  seed?: number | undefined
  bpm?: number | undefined
  key?: string | undefined
  style_tags?: string[] | undefined
  reference_audio_path?: string | null | undefined
  output_format?: MusicLabOutputFormat | undefined
  master?: boolean | undefined
  engine?: MusicLabEngine | null | undefined
}

export interface MusicLabRepaintParams extends MusicLabGenerateParams {
  source_audio_path: string
  start_s: number
  end_s: number
}

export interface MusicLabCoverParams extends MusicLabGenerateParams {
  source_audio_path: string
}

export interface MusicLabStemsParams extends MusicLabGenerateParams {
  source_audio_path?: string | null | undefined
}

export interface MusicLabErrorBody {
  code: string
  message: string
  details: Record<string, unknown>
}

export interface MusicLabGenerationResult {
  job_id: string
  audio_path: string
  duration_s: number
  sample_rate: number
  engine: MusicLabEngine
  mode: MusicLabEngine
  output_format: MusicLabOutputFormat
  metadata: Record<string, unknown>
}

export interface MusicLabStemsResult {
  job_id: string
  stems: Record<MusicLabStem, string>
  duration_s: number
  sample_rate: number
  engine: MusicLabEngine
  mode: MusicLabEngine
  metadata: Record<string, unknown>
}

export type MusicLabResult = MusicLabGenerationResult | MusicLabStemsResult

export interface MusicLabJob {
  job_id: string
  operation: MusicLabOperation
  status: MusicLabJobStatus
  engine: MusicLabEngine | null
  mode: MusicLabEngine | null
  result: MusicLabResult | null
  error: MusicLabErrorBody | null
  created_at: string
  updated_at: string
}

export interface MusicLabJobAccepted {
  job_id: string
  status: MusicLabJobStatus
  status_url: string
}

export interface MusicLabAdapterHealth {
  engine: MusicLabEngine
  ready: boolean
  reason: string | null
  device: string | null
  details: Record<string, unknown>
}

export interface MusicLabServiceHealth {
  status: 'ok' | 'degraded'
  service: string
  version: string
  mode: string
  engine: MusicLabAdapterHealth | null
  reason: string | null
}

export interface MusicLabCapabilities {
  service: string
  default_mode: string
  active_engine: MusicLabEngine | null
  modes: string[]
  engines: MusicLabEngine[]
  methods: string[]
  output_formats: MusicLabOutputFormat[]
  max_concurrency: number
}

export interface MusicLabDownload {
  buffer: ArrayBuffer
  contentType: string
  filename: string | null
}

export interface MusicLabWaitOptions {
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface MusicLabClientOptions {
  baseUrl?: string
  apiKey?: string
  timeoutMs?: number
}

export class MusicLabClientError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'MusicLabClientError'
    this.code = code
    this.status = status
    this.details = details
    Object.setPrototypeOf(this, MusicLabClientError.prototype)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseErrorPayload(value: unknown): MusicLabErrorBody {
  if (!isRecord(value)) {
    return { code: 'MUSIC_LAB_ERROR', message: 'Music Lab request failed', details: {} }
  }
  const rawDetails = value['details']
  return {
    code: typeof value['code'] === 'string' ? value['code'] : 'MUSIC_LAB_ERROR',
    message: typeof value['message'] === 'string' ? value['message'] : 'Music Lab request failed',
    details: isRecord(rawDetails) ? rawDetails : {},
  }
}

function parseFilename(disposition: string | null): string | null {
  if (disposition === null) return null
  const match = /filename="([^"]+)"/.exec(disposition)
  return match?.[1] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MusicLabClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(options: MusicLabClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.MUSIC_LAB_URL).replace(/\/$/, '')
    this.apiKey = options.apiKey ?? config.MUSIC_LAB_API_KEY
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async health(): Promise<MusicLabServiceHealth> {
    return this.requestJson<MusicLabServiceHealth>('/health')
  }

  async capabilities(): Promise<MusicLabCapabilities> {
    return this.requestJson<MusicLabCapabilities>('/v1/capabilities')
  }

  async generate(params: MusicLabGenerateParams): Promise<MusicLabJobAccepted> {
    return this.requestJson<MusicLabJobAccepted>('/v1/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async repaint(params: MusicLabRepaintParams): Promise<MusicLabJobAccepted> {
    return this.requestJson<MusicLabJobAccepted>('/v1/repaint', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async cover(params: MusicLabCoverParams): Promise<MusicLabJobAccepted> {
    return this.requestJson<MusicLabJobAccepted>('/v1/cover', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async stems(params: MusicLabStemsParams): Promise<MusicLabJobAccepted> {
    return this.requestJson<MusicLabJobAccepted>('/v1/stems', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async getJob(jobId: string): Promise<MusicLabJob> {
    return this.requestJson<MusicLabJob>(`/v1/jobs/${encodeURIComponent(jobId)}`)
  }

  async getAudio(jobId: string, stem?: MusicLabStem): Promise<MusicLabDownload> {
    const query = stem === undefined ? '' : `?stem=${encodeURIComponent(stem)}`
    const response = await this.send(
      `/v1/jobs/${encodeURIComponent(jobId)}/audio${query}`,
      undefined,
      60_000,
    )
    if (!response.ok) {
      const payload = parseErrorPayload(await this.readJson(response))
      throw new MusicLabClientError(payload.code, payload.message, response.status, payload.details)
    }
    return {
      buffer: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') ?? 'audio/wav',
      filename: parseFilename(response.headers.get('content-disposition')),
    }
  }

  async waitForJob(jobId: string, options: MusicLabWaitOptions = {}): Promise<MusicLabJob> {
    const timeoutMs = options.timeoutMs ?? 10 * 60_000
    const pollIntervalMs = options.pollIntervalMs ?? 1_000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const job = await this.getJob(jobId)
      if (job.status === 'succeeded') return job
      if (job.status === 'failed') {
        const error = job.error
        throw new MusicLabClientError(
          error?.code ?? 'MUSIC_LAB_JOB_FAILED',
          error?.message ?? `Music Lab job ${jobId} failed`,
          502,
          error?.details ?? { job_id: jobId },
        )
      }
      await sleep(pollIntervalMs)
    }

    throw new MusicLabClientError(
      'MUSIC_LAB_TIMEOUT',
      `Timed out waiting for Music Lab job ${jobId}`,
      504,
      { job_id: jobId, timeout_ms: timeoutMs },
    )
  }

  async generateAndWait(
    params: MusicLabGenerateParams,
    options: MusicLabWaitOptions = {},
  ): Promise<MusicLabGenerationResult> {
    const accepted = await this.generate(params)
    const job = await this.waitForJob(accepted.job_id, options)
    if (job.result === null || !('audio_path' in job.result)) {
      throw new MusicLabClientError(
        'MUSIC_LAB_INVALID_RESULT',
        `Music Lab job ${accepted.job_id} returned no generation result`,
        502,
        { job_id: accepted.job_id },
      )
    }
    return job.result
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.send(path, init)
    const body = await this.readJson(response)
    if (!response.ok) {
      const payload = parseErrorPayload(body)
      throw new MusicLabClientError(payload.code, payload.message, response.status, payload.details)
    }
    return body as T
  }

  private async send(
    path: string,
    init?: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (this.apiKey !== '') headers.set('x-api-key', this.apiKey)
    if (init?.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new MusicLabClientError(
        'MUSIC_LAB_UNREACHABLE',
        `Music Lab is unreachable: ${message}`,
        502,
        { cause: message },
      )
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }
}

export const musicLabClient = new MusicLabClient()
