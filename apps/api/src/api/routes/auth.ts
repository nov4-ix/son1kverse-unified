// ─── SON1KVERSE — Auth Routes ──────────────────────────────────────────────────
// Register/login que emiten el JWT necesario para todo /api/v1/*.
// Contraseñas: scrypt async + salt (node:crypto). Nunca se compara en texto plano.

import type { FastifyInstance } from 'fastify'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  generationLimitForTier,
  storageLimitForTier,
  DEFAULT_SUBSCRIPTION_TIER,
} from '@son1k/shared-types'
import { AuthTokenType } from '@son1k/db'
import {
  ForgotPasswordSchema,
  LoginSchema,
  RegisterUserSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
  successResponse,
} from '../../core/contracts.js'
import {
  AccountDisabledError,
  InvalidCredentialsError,
  NotFoundError,
  UserAlreadyExistsError,
  ValidationError,
} from '../../core/errors.js'
import { prisma } from '../../storage/client.js'
import { config } from '../../config/index.js'
import { logger } from '../../lib/logger.js'
import {
  consumeAuthToken,
  createSession,
  issueAuthToken,
  revokeSession,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../../services/AuthTokenService.js'
import { getAuthSessionId, getAuthUserId } from '../request-auth.js'

const KEY_LEN = 64
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, KEY_LEN)).toString('hex')
  return `${salt}:${hash}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  // Sin formato "salt:hash" no es una contraseña válida → nunca da match.
  if (!salt || !hash || hash.length !== KEY_LEN * 2) return false
  const candidate = await scryptAsync(password, salt, KEY_LEN)
  const expected  = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

// Rate limit estricto: frena fuerza bruta y creación masiva de cuentas.
const AUTH_RATE_LIMIT = {
  rateLimit: {
    max: 10,
    timeWindow: '1 minute',
  },
} as const

const EMAIL_RATE_LIMIT = {
  rateLimit: {
    max: 5,
    timeWindow: '1 minute',
  },
} as const

function signSessionToken(
  app: FastifyInstance,
  user: { id: string; alias: string; email: string },
  sessionId: string,
): string {
  return app.jwt.sign(
    { sub: user.id, alias: user.alias, email: user.email, jti: sessionId },
    { expiresIn: config.JWT_EXPIRES_IN },
  )
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/register — crea usuario y devuelve JWT
  app.post('/auth/register', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const parsed = RegisterUserSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const { email, alias, password } = parsed.data

    if (await prisma.user.findUnique({ where: { email } })) {
      throw new UserAlreadyExistsError('email', email)
    }
    if (await prisma.user.findUnique({ where: { alias } })) {
      throw new UserAlreadyExistsError('alias', alias)
    }

    const tier = DEFAULT_SUBSCRIPTION_TIER
    const user = await prisma.user.create({
      data: {
        email,
        alias,
        passwordHash: await hashPassword(password),
        subscriptionTier: tier,
        generationsLimit: generationLimitForTier(tier),
        storageLimit: BigInt(storageLimitForTier(tier)),
      },
    })

    const sessionId = await createSession(user.id)
    const token = signSessionToken(app, user, sessionId)

    try {
      const verificationToken = await issueAuthToken(
        user.id,
        AuthTokenType.EMAIL_VERIFICATION,
        config.EMAIL_VERIFICATION_TTL_MINUTES,
      )
      await sendVerificationEmail(user.email, verificationToken)
    } catch (error) {
      // El registro no se cae si el proveedor de correo falla; el usuario
      // puede pedir un reenvío desde la app.
      logger.error({ error, userId: user.id }, 'No se pudo enviar la verificación de correo')
    }

    return reply.status(201).send(successResponse({
      token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      email_verified: user.isEmailVerified,
      user: { id: user.id, email: user.email, alias: user.alias, emailVerified: user.isEmailVerified },
    }))
  })

  // POST /api/v1/auth/login — verifica credenciales y devuelve JWT
  app.post('/auth/login', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      throw new InvalidCredentialsError()
    }
    if (!user.isActive) throw new AccountDisabledError()

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const sessionId = await createSession(user.id)
    const token = signSessionToken(app, user, sessionId)

    return reply.status(200).send(successResponse({
      token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      email_verified: user.isEmailVerified,
      user: { id: user.id, email: user.email, alias: user.alias, emailVerified: user.isEmailVerified },
    }))
  })

  // POST /api/v1/auth/logout — revoca la sesión del jti actual.
  app.post('/auth/logout', async (req, reply) => {
    const sessionId = getAuthSessionId(req)
    if (sessionId !== null) await revokeSession(sessionId)
    return reply.status(200).send(successResponse({ loggedOut: true }))
  })

  app.get('/auth/me', async (req, reply) => {
    const userId = getAuthUserId(req)

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { alvaeAccount: true },
    })
    if (user === null) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' },
      })
    }

    return reply.status(200).send(successResponse({
      user: {
        id: user.id,
        email: user.email,
        alias: user.alias,
        generationsUsedThisMonth: user.generationsUsedThisMonth,
        generationsLimit: user.generationsLimit,
        storageUsedBytes: Number(user.storageUsedBytes),
        storageLimit: Number(user.storageLimit),
        subscriptionTier: user.subscriptionTier,
        emailVerified: user.isEmailVerified,
        isActive: user.isActive,
      },
      alvaeAccount: user.alvaeAccount === null
        ? null
        : {
            role: user.alvaeAccount.role,
            tier: user.alvaeAccount.tier,
            alvaeSymbol: user.alvaeAccount.alvaeSymbol,
            alvaeColor: user.alvaeAccount.alvaeColor,
            permissions: user.alvaeAccount.permissions,
            isBlindado: user.alvaeAccount.isBlindado,
          },
    }))
  })

  // POST /api/v1/auth/verify-email — consume un token de un solo uso.
  app.post('/auth/verify-email', { config: EMAIL_RATE_LIMIT }, async (req, reply) => {
    const parsed = VerifyEmailSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = await consumeAuthToken(parsed.data.token, AuthTokenType.EMAIL_VERIFICATION)
    await prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    })
    return reply.status(200).send(successResponse({ verified: true }))
  })

  // POST /api/v1/auth/verification/resend — reenvía el enlace al usuario actual.
  app.post('/auth/verification/resend', { config: EMAIL_RATE_LIMIT }, async (req, reply) => {
    const userId = getAuthUserId(req)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isEmailVerified: true },
    })
    if (user === null) throw new NotFoundError('Usuario no encontrado')

    if (!user.isEmailVerified) {
      try {
        const token = await issueAuthToken(
          userId,
          AuthTokenType.EMAIL_VERIFICATION,
          config.EMAIL_VERIFICATION_TTL_MINUTES,
        )
        await sendVerificationEmail(user.email, token)
      } catch (error) {
        logger.error({ error, userId }, 'No se pudo reenviar la verificación de correo')
      }
    }

    return reply.status(200).send(successResponse({ sent: !user.isEmailVerified }))
  })

  // POST /api/v1/auth/password/forgot — respuesta genérica para no enumerar.
  app.post('/auth/password/forgot', { config: EMAIL_RATE_LIMIT }, async (req, reply) => {
    const parsed = ForgotPasswordSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, isActive: true },
    })
    if (user !== null && user.isActive) {
      try {
        const token = await issueAuthToken(
          user.id,
          AuthTokenType.PASSWORD_RESET,
          config.PASSWORD_RESET_TTL_MINUTES,
        )
        await sendPasswordResetEmail(user.email, token)
      } catch (error) {
        logger.error({ error, userId: user.id }, 'No se pudo enviar el reset de contraseña')
      }
    }

    return reply.status(200).send(successResponse({
      message: 'Si el correo existe, enviamos un enlace para restablecer la contraseña.',
    }))
  })

  // POST /api/v1/auth/password/reset — token de un solo uso + revoca sesiones.
  app.post('/auth/password/reset', { config: EMAIL_RATE_LIMIT }, async (req, reply) => {
    const parsed = ResetPasswordSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const userId = await consumeAuthToken(parsed.data.token, AuthTokenType.PASSWORD_RESET)
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    })
    await prisma.refreshToken.deleteMany({ where: { userId } })

    return reply.status(200).send(successResponse({ reset: true }))
  })
}
