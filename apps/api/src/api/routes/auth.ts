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
import { LoginSchema, RegisterUserSchema, successResponse } from '../../core/contracts.js'
import { InvalidCredentialsError, UserAlreadyExistsError } from '../../core/errors.js'
import { ValidationError } from '../../core/errors.js'
import { prisma } from '../../storage/client.js'
import { config } from '../../config/index.js'
import { getAuthUserId } from '../request-auth.js'

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
        password: await hashPassword(password),
        subscriptionTier: tier,
        generationsLimit: generationLimitForTier(tier),
        storageLimit: BigInt(storageLimitForTier(tier)),
      },
    })

    const token = app.jwt.sign(
      { sub: user.id, alias: user.alias, email: user.email },
      { expiresIn: config.JWT_EXPIRES_IN },
    )

    return reply.status(201).send(successResponse({
      token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, alias: user.alias },
    }))
  })

  // POST /api/v1/auth/login — verifica credenciales y devuelve JWT
  app.post('/auth/login', { config: AUTH_RATE_LIMIT }, async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (!user || !(await verifyPassword(parsed.data.password, user.password))) {
      throw new InvalidCredentialsError()
    }

    const token = app.jwt.sign(
      { sub: user.id, alias: user.alias, email: user.email },
      { expiresIn: config.JWT_EXPIRES_IN },
    )

    return reply.status(200).send(successResponse({
      token,
      tokenType: 'Bearer',
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, alias: user.alias },
    }))
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
}
