// ─── Cloudflare R2 (S3-compatible) ──────────────────────────────────────────
// Cliente mínimo con AWS Signature V4 para no añadir el SDK completo.
// Las credenciales llegan solo por entorno. Si falta una, `isConfigured()`
// devuelve false y el llamador degrada a almacenamiento local.

import { createHash, createHmac } from 'node:crypto'
import { config } from '../config/index.js'

export type R2Options = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  keyPrefix: string
  signedUrlTtlSeconds: number
}

export type R2Upload = {
  key: string
  url: string
  expiresAt: string
}

const R2_REGION = 'auto'
const R2_SERVICE = 's3'
const MAX_SIGNED_URL_TTL_S = 604_800

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/')
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, dateStamp)
  const regionKey = hmac(dateKey, R2_REGION)
  const serviceKey = hmac(regionKey, R2_SERVICE)
  return hmac(serviceKey, 'aws4_request')
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function safeExtension(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  return normalized === 'mp3' ? 'mp3' : 'wav'
}

export class R2Client {
  constructor(private readonly options: R2Options) {}

  get bucket(): string {
    return this.options.bucket
  }

  isConfigured(): boolean {
    return (
      this.options.accountId !== '' &&
      this.options.accessKeyId !== '' &&
      this.options.secretAccessKey !== '' &&
      this.options.bucket !== ''
    )
  }

  buildGenerationKey(userId: string, jobId: string, extension: string): string {
    const prefix = this.options.keyPrefix.replace(/^\/+|\/+$/g, '') || 'generations'
    return `${prefix}/${safeSegment(userId)}/${safeSegment(jobId)}.${safeExtension(extension)}`
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const { host, uri } = this.endpoint(key)
    const { amzDate, dateStamp } = amzDates(new Date())
    const payloadHash = sha256Hex(body)
    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
      '',
    ].join('\n')
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      'PUT',
      uri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')
    const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = createHmac(
      'sha256',
      signingKey(this.options.secretAccessKey, dateStamp),
    )
      .update(stringToSign)
      .digest('hex')
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`

    const response = await fetch(`https://${host}${uri}`, {
      method: 'PUT',
      headers: {
        'content-type': contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        authorization,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`R2 PUT failed (${response.status}): ${detail.slice(0, 200)}`)
    }
  }

  signedGetUrl(key: string, ttlSeconds?: number): R2Upload {
    const ttl = Math.min(
      Math.max(Math.trunc(ttlSeconds ?? this.options.signedUrlTtlSeconds), 60),
      MAX_SIGNED_URL_TTL_S,
    )
    const { host, uri } = this.endpoint(key)
    const now = new Date()
    const { amzDate, dateStamp } = amzDates(now)
    const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`
    const queryParams: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.options.accessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(ttl)],
      ['X-Amz-SignedHeaders', 'host'],
    ]
    const query = queryParams
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join('&')
    const canonicalRequest = [
      'GET',
      uri,
      query,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = createHmac(
      'sha256',
      signingKey(this.options.secretAccessKey, dateStamp),
    )
      .update(stringToSign)
      .digest('hex')
    return {
      key,
      url: `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`,
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    }
  }

  private endpoint(key: string): { host: string; uri: string } {
    const host = `${this.options.accountId}.r2.cloudflarestorage.com`
    return { host, uri: `/${encodeRfc3986(this.options.bucket)}/${encodeKeyPath(key)}` }
  }
}

export function r2OptionsFromConfig(): R2Options {
  return {
    accountId: config.R2_ACCOUNT_ID ?? '',
    accessKeyId: config.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: config.R2_SECRET_ACCESS_KEY ?? '',
    bucket: config.R2_BUCKET ?? '',
    keyPrefix: config.R2_KEY_PREFIX,
    signedUrlTtlSeconds: config.R2_SIGNED_URL_TTL_SECONDS,
  }
}

export const r2 = new R2Client(r2OptionsFromConfig())

export function r2KeyFromAudioUrl(audioUrl: string | null | undefined): string | null {
  if (audioUrl === null || audioUrl === undefined) return null
  const prefix = `r2://${r2.bucket}/`
  if (!audioUrl.startsWith(prefix)) return null
  const key = audioUrl.slice(prefix.length)
  return key === '' ? null : key
}
