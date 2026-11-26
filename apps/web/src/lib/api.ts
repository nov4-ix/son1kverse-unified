import { FREE_GENERATIONS_PER_MONTH } from '@son1k/shared-types'

const API_PREFIX = '/api/v1'

export type EngineName = 'simulation' | 'ace-step'
export type QualityPreset = 'turbo' | 'xl_turbo'
export type OutputFormat = 'wav' | 'mp3'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type MusicOperation = 'generate' | 'repaint' | 'cover' | 'stems'
export type StemName = 'drums' | 'bass' | 'other'

export type GenerateRequest = {
  prompt: string
  lyrics?: string | null
  duration_s?: number
  seed?: number
  bpm?: number
  key?: string
  style_tags?: string[]
  reference_audio_path?: string | null
  output_format?: OutputFormat
  master?: boolean
  engine?: EngineName | null
  quality_preset?: QualityPreset
}

export type RepaintRequest = GenerateRequest & {
  source_audio_path: string
  start_s: number
  end_s: number
}

export type CoverRequest = GenerateRequest & {
  source_audio_path: string
}

export type StemsRequest = GenerateRequest & {
  source_audio_path?: string | null
}

export type JobAccepted = {
  job_id: string
  status: JobStatus
  status_url: string
  job_url?: string
  audio_url?: string
}

export type GenerationResult = {
  job_id: string
  audio_path: string
  duration_s: number
  sample_rate: number
  engine: EngineName
  mode: EngineName
  output_format?: OutputFormat
  metadata?: Record<string, unknown>
}

export type StemsResult = {
  job_id: string
  stems: Partial<Record<StemName, string>>
  duration_s: number
  sample_rate: number
  engine: EngineName
  mode: EngineName
  metadata?: Record<string, unknown>
}

export type MusicErrorBody = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type MusicJob = {
  job_id: string
  operation: MusicOperation
  status: JobStatus
  engine: EngineName | null
  mode: EngineName | null
  result: GenerationResult | StemsResult | null
  error: MusicErrorBody | null
  created_at: string
  updated_at: string
}

export type MusicCapabilities = {
  active_engine: string
  methods: string[]
  supports_stems: boolean
  active_methods: string[]
}

export type GenerationHistoryItem = {
  id: string
  externalJobId: string | null
  prompt: string
  status: string
  qualityPreset: string | null
  modelVersion: string | null
  durationS: number | null
  bpm: number | null
  musicalKey: string | null
  audioUrl: string | null
  createdAt: string
}

export type GenerationHistoryPage = {
  items: GenerationHistoryItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type AuthUser = {
  id: string
  email: string
  alias: string
}

export type AlvaeCredential = {
  role: string
  tier: string
  alvaeSymbol: string
  alvaeColor: string
  permissions: string[]
  isBlindado: boolean
}

export type AuthSession = {
  token: string
  tokenType: string
  expiresIn: string
  user: AuthUser
}

export type AuthProfile = {
  user: AuthUser & {
    generationsUsedThisMonth: number
    generationsLimit: number
    storageUsedBytes: number
    storageLimit: number
    subscriptionTier: string
  }
  alvaeAccount: AlvaeCredential | null
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function unwrapData(payload: unknown): unknown {
  if (isRecord(payload) && payload['success'] === true) {
    return payload['data']
  }
  return payload
}

function readError(payload: unknown, status: number): ApiError {
  if (isRecord(payload) && isRecord(payload['error'])) {
    const error = payload['error']
    return new ApiError(
      asString(error['code'], 'API_ERROR'),
      asString(error['message'], 'Request failed'),
      status,
    )
  }
  if (isRecord(payload)) {
    return new ApiError(
      asString(payload['code'], 'API_ERROR'),
      asString(payload['message'], 'Request failed'),
      status,
    )
  }
  return new ApiError('API_ERROR', 'Request failed', status)
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function authHeader(token: string | null): HeadersInit {
  if (token === null || token === '') return {}
  return { Authorization: `Bearer ${token}` }
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  token: string | null = null,
): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const auth = authHeader(token)
  if ('Authorization' in auth) {
    headers.set('Authorization', auth.Authorization)
  }

  const response = await fetch(path, { ...init, headers })
  const payload = await parseJson(response)
  if (!response.ok) throw readError(payload, response.status)
  return unwrapData(payload)
}

function parseJobAccepted(value: unknown): JobAccepted {
  if (!isRecord(value)) {
    throw new ApiError('INVALID_JOB', 'Respuesta de job inválida', 502)
  }
  return {
    job_id: asString(value['job_id']),
    status: asString(value['status'], 'queued') as JobStatus,
    status_url: asString(value['status_url']),
    job_url: typeof value['job_url'] === 'string' ? value['job_url'] : undefined,
    audio_url: typeof value['audio_url'] === 'string' ? value['audio_url'] : undefined,
  }
}

function parseGenerationResult(value: Record<string, unknown>): GenerationResult {
  return {
    job_id: asString(value['job_id']),
    audio_path: asString(value['audio_path']),
    duration_s: asNumber(value['duration_s']),
    sample_rate: asNumber(value['sample_rate']),
    engine: asString(value['engine'], 'simulation') as EngineName,
    mode: asString(value['mode'], 'simulation') as EngineName,
    output_format: typeof value['output_format'] === 'string'
      ? (value['output_format'] as OutputFormat)
      : undefined,
    metadata: isRecord(value['metadata']) ? value['metadata'] : undefined,
  }
}

function parseStemsResult(value: Record<string, unknown>): StemsResult {
  const rawStems = isRecord(value['stems']) ? value['stems'] : {}
  const stems: Partial<Record<StemName, string>> = {}
  for (const name of ['drums', 'bass', 'other'] as const) {
    const path = rawStems[name]
    if (typeof path === 'string') stems[name] = path
  }
  return {
    job_id: asString(value['job_id']),
    stems,
    duration_s: asNumber(value['duration_s']),
    sample_rate: asNumber(value['sample_rate']),
    engine: asString(value['engine'], 'simulation') as EngineName,
    mode: asString(value['mode'], 'simulation') as EngineName,
    metadata: isRecord(value['metadata']) ? value['metadata'] : undefined,
  }
}

function parseJob(value: unknown): MusicJob {
  if (!isRecord(value)) {
    throw new ApiError('INVALID_JOB', 'Job inválido', 502)
  }
  const rawResult = value['result']
  let result: GenerationResult | StemsResult | null = null
  if (isRecord(rawResult)) {
    result = 'stems' in rawResult
      ? parseStemsResult(rawResult)
      : parseGenerationResult(rawResult)
  }
  const rawError = value['error']
  return {
    job_id: asString(value['job_id']),
    operation: asString(value['operation'], 'generate') as MusicOperation,
    status: asString(value['status'], 'queued') as JobStatus,
    engine: typeof value['engine'] === 'string' ? (value['engine'] as EngineName) : null,
    mode: typeof value['mode'] === 'string' ? (value['mode'] as EngineName) : null,
    result,
    error: isRecord(rawError)
      ? {
          code: asString(rawError['code'], 'JOB_FAILED'),
          message: asString(rawError['message'], 'Job failed'),
        }
      : null,
    created_at: asString(value['created_at']),
    updated_at: asString(value['updated_at']),
  }
}

function parseAuthSession(value: unknown): AuthSession {
  if (!isRecord(value) || !isRecord(value['user'])) {
    throw new ApiError('INVALID_AUTH', 'Sesión inválida', 502)
  }
  return {
    token: asString(value['token']),
    tokenType: asString(value['tokenType'], 'Bearer'),
    expiresIn: asString(value['expiresIn']),
    user: {
      id: asString(value['user']['id']),
      email: asString(value['user']['email']),
      alias: asString(value['user']['alias']),
    },
  }
}

function parseAuthProfile(value: unknown): AuthProfile {
  if (!isRecord(value) || !isRecord(value['user'])) {
    throw new ApiError('INVALID_PROFILE', 'Perfil inválido', 502)
  }
  const user = value['user']
  const alvae = isRecord(value['alvaeAccount']) ? value['alvaeAccount'] : null
  return {
    user: {
      id: asString(user['id']),
      email: asString(user['email']),
      alias: asString(user['alias']),
      generationsUsedThisMonth: asNumber(user['generationsUsedThisMonth']),
      generationsLimit: asNumber(user['generationsLimit'], FREE_GENERATIONS_PER_MONTH),
      storageUsedBytes: asNumber(user['storageUsedBytes']),
      storageLimit: asNumber(user['storageLimit'], 1073741824),
      subscriptionTier: asString(user['subscriptionTier'], 'FREE'),
    },
    alvaeAccount: alvae === null
      ? null
      : {
          role: asString(alvae['role']),
          tier: asString(alvae['tier']),
          alvaeSymbol: asString(alvae['alvaeSymbol'], '◯⚡'),
          alvaeColor: asString(alvae['alvaeColor'], '#D4A359'),
          permissions: Array.isArray(alvae['permissions'])
            ? alvae['permissions'].filter((item): item is string => typeof item === 'string')
            : [],
          isBlindado: asBoolean(alvae['isBlindado']),
        },
  }
}

export function jobAudioUrl(jobId: string, stem?: StemName): string {
  const query = stem === undefined ? '' : `?stem=${encodeURIComponent(stem)}`
  return `${API_PREFIX}/music/jobs/${encodeURIComponent(jobId)}/audio${query}`
}

export function isGenerationResult(
  result: GenerationResult | StemsResult | null,
): result is GenerationResult {
  return result !== null && 'audio_path' in result
}

export function isStemsResult(
  result: GenerationResult | StemsResult | null,
): result is StemsResult {
  return result !== null && 'stems' in result
}

async function postMusicJob(path: string, body: unknown, token: string | null): Promise<JobAccepted> {
  const payload = await requestJson(`${API_PREFIX}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)
  return parseJobAccepted(payload)
}

export async function fetchAuthorizedBlob(
  path: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(path, {
    headers: authHeader(token),
    ...(signal !== undefined ? { signal } : {}),
  })
  if (!response.ok) {
    const payload = await parseJson(response)
    throw readError(payload, response.status)
  }
  return response.blob()
}

export const api = {
  health: async (): Promise<{ status: string; version: string; pixel: string }> => {
    const payload = await requestJson('/health')
    if (!isRecord(payload)) {
      throw new ApiError('HEALTH_INVALID', 'Health inválido', 502)
    }
    return {
      status: asString(payload['status'], 'unknown'),
      version: asString(payload['version']),
      pixel: asString(payload['pixel']),
    }
  },

  login: async (email: string, password: string): Promise<AuthSession> => {
    const payload = await requestJson(`${API_PREFIX}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    return parseAuthSession(payload)
  },

  register: async (email: string, alias: string, password: string): Promise<AuthSession> => {
    const payload = await requestJson(`${API_PREFIX}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email, alias, password }),
    })
    return parseAuthSession(payload)
  },

  me: async (token: string): Promise<AuthProfile> => {
    const payload = await requestJson(`${API_PREFIX}/auth/me`, { method: 'GET' }, token)
    return parseAuthProfile(payload)
  },

  generate: (body: GenerateRequest, token: string | null): Promise<JobAccepted> => {
    return postMusicJob('/music/generate', body, token)
  },

  repaint: (body: RepaintRequest, token: string | null): Promise<JobAccepted> => {
    return postMusicJob('/music/repaint', body, token)
  },

  cover: (body: CoverRequest, token: string | null): Promise<JobAccepted> => {
    return postMusicJob('/music/cover', body, token)
  },

  stems: (body: StemsRequest, token: string | null): Promise<JobAccepted> => {
    return postMusicJob('/music/stems', body, token)
  },

  getMusicCapabilities: async (): Promise<MusicCapabilities> => {
    const payload = await requestJson(`${API_PREFIX}/music/capabilities`, { method: 'GET' })
    const rec = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : isRecord(payload) ? payload : {}
    const methods = Array.isArray(rec['methods']) ? rec['methods'].filter((m): m is string => typeof m === 'string') : []
    const activeEngine = typeof rec['active_engine'] === 'string' ? rec['active_engine'] : 'simulation'
    const supportsStems = typeof rec['supports_stems'] === 'boolean' ? rec['supports_stems'] : activeEngine === 'simulation' && methods.includes('stems')
    const activeMethods = Array.isArray(rec['active_methods'])
      ? rec['active_methods'].filter((m): m is string => typeof m === 'string')
      : supportsStems ? methods : methods.filter((m) => m !== 'stems')
    return { active_engine: activeEngine, methods, supports_stems: supportsStems, active_methods: activeMethods }
  },

  listGenerations: async (
    params: { limit?: number; offset?: number },
    token: string | null,
  ): Promise<GenerationHistoryPage> => {
    const search = new URLSearchParams()
    if (params.limit !== undefined) search.set('limit', String(params.limit))
    if (params.offset !== undefined) search.set('offset', String(params.offset))
    const qs = search.toString()
    const payload = await requestJson(`${API_PREFIX}/music/generations${qs ? `?${qs}` : ''}`, { method: 'GET' }, token)
    const data = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : isRecord(payload) ? payload : {}
    const rawItems = Array.isArray(data['items']) ? data['items'] : []
    const items: GenerationHistoryItem[] = rawItems.filter(isRecord).map((row) => ({
      id: typeof row['id'] === 'string' ? row['id'] : '',
      externalJobId: typeof row['externalJobId'] === 'string' ? row['externalJobId'] : null,
      prompt: typeof row['prompt'] === 'string' ? row['prompt'] : '',
      status: typeof row['status'] === 'string' ? row['status'] : 'completed',
      qualityPreset: typeof row['qualityPreset'] === 'string' ? row['qualityPreset'] : null,
      modelVersion: typeof row['modelVersion'] === 'string' ? row['modelVersion'] : null,
      durationS: typeof row['durationS'] === 'number' ? row['durationS'] : null,
      bpm: typeof row['bpm'] === 'number' ? row['bpm'] : null,
      musicalKey: typeof row['musicalKey'] === 'string' ? row['musicalKey'] : null,
      audioUrl: typeof row['audioUrl'] === 'string' ? row['audioUrl'] : null,
      createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : new Date().toISOString(),
    }))
    const total = asNumber(data['total'], items.length)
    const limit = asNumber(data['limit'], params.limit ?? 20)
    const offset = asNumber(data['offset'], params.offset ?? 0)
    const hasMore = typeof data['hasMore'] === 'boolean' ? data['hasMore'] : offset + items.length < total
    return { items, total, limit, offset, hasMore }
  },

  getJob: async (jobId: string, token: string | null): Promise<MusicJob> => {
    const payload = await requestJson(
      `${API_PREFIX}/music/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
      token,
    )
    return parseJob(payload)
  },

  pollJob: async (
    jobId: string,
    token: string | null,
    onTick?: (job: MusicJob) => void,
    intervalMs = 800,
    timeoutMs = 10 * 60_000,
  ): Promise<MusicJob> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const job = await api.getJob(jobId, token)
      onTick?.(job)
      if (job.status === 'succeeded' || job.status === 'failed') return job
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
    }
    throw new ApiError('JOB_TIMEOUT', `Timeout esperando el job ${jobId}`, 504)
  },
}
