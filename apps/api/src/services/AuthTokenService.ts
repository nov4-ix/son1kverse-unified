// ─── SON1KVERSE — Sesiones revocables y tokens de un solo uso ─────────────────
// Los JWT llevan un `jti` que apunta a RefreshToken. Si el registro desaparece
// (logout, reset de contraseña), el JWT deja de ser aceptado aunque no expire.
// Los tokens de email/reset se guardan hasheados y se consumen una sola vez.

import { createHash, randomBytes } from 'node:crypto'
import type { AuthTokenType } from '@son1k/db'
import { prisma } from '../storage/client.js'
import { config } from '../config/index.js'
import { ValidationError } from '../core/errors.js'
import { sendEmail } from './EmailService.js'

const DEFAULT_SESSION_MS = 7 * 24 * 60 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function parseExpiresIn(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim())
  if (match === null) return DEFAULT_SESSION_MS
  const amount = Number(match[1])
  const unit = match[2]
  const factor = unit === 's'
    ? 1_000
    : unit === 'm'
      ? 60_000
      : unit === 'h'
        ? 3_600_000
        : 86_400_000
  return amount * factor
}

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + parseExpiresIn(config.JWT_EXPIRES_IN))
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = generateOpaqueToken()
  await prisma.refreshToken.create({
    data: {
      token: sessionId,
      userId,
      expiresAt: sessionExpiresAt(),
    },
  })
  return sessionId
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token: sessionId } })
}

export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.refreshToken.findUnique({ where: { token: sessionId } })
  return session !== null && session.expiresAt.getTime() > Date.now()
}

export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMinutes: number,
): Promise<string> {
  const now = new Date()
  // Un solo token vigente por tipo: pedir uno nuevo invalida el anterior.
  await prisma.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: now },
  })

  const rawToken = generateOpaqueToken()
  await prisma.authToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      type,
      userId,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    },
  })
  return rawToken
}

export async function consumeAuthToken(
  rawToken: string,
  type: AuthTokenType,
): Promise<string> {
  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (
    record === null
    || record.type !== type
    || record.usedAt !== null
    || record.expiresAt.getTime() <= Date.now()
  ) {
    throw new ValidationError({ token: 'El enlace no es válido o ya expiró' })
  }

  const claimed = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) {
    throw new ValidationError({ token: 'El enlace no es válido o ya expiró' })
  }
  return record.userId
}

function appLink(path: string, token: string): string {
  return `${config.APP_BASE_URL.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = appLink('/verify-email', token)
  await sendEmail({
    to: email,
    subject: 'Verifica tu correo en SON1KVERSE',
    text: `Confirma tu correo para empezar a crear en SON1KVERSE:\n\n${link}\n\nEl enlace caduca en ${config.EMAIL_VERIFICATION_TTL_MINUTES} minutos y solo puede usarse una vez.`,
    html: `<p>Confirma tu correo para empezar a crear en SON1KVERSE:</p><p><a href="${link}">Verificar correo</a></p><p>El enlace caduca en ${config.EMAIL_VERIFICATION_TTL_MINUTES} minutos y solo puede usarse una vez.</p>`,
  })
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const link = appLink('/reset-password', token)
  await sendEmail({
    to: email,
    subject: 'Restablece tu contraseña de SON1KVERSE',
    text: `Pediste restablecer tu contraseña:\n\n${link}\n\nEl enlace caduca en ${config.PASSWORD_RESET_TTL_MINUTES} minutos y solo puede usarse una vez. Si no fuiste tú, ignora este mensaje.`,
    html: `<p>Pediste restablecer tu contraseña:</p><p><a href="${link}">Elegir una nueva contraseña</a></p><p>El enlace caduca en ${config.PASSWORD_RESET_TTL_MINUTES} minutos y solo puede usarse una vez. Si no fuiste tú, ignora este mensaje.</p>`,
  })
}
