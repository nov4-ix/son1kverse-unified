// ─── SON1KVERSE — Auth Routes ──────────────────────────────────────────────────
// Register/login que emiten el JWT necesario para consumir /api/v1/audio/*.
// Contraseñas: scrypt + salt (node:crypto). Nunca se compara en texto plano.

import type { FastifyInstance } from 'fastify'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { LoginSchema, RegisterUserSchema, successResponse } from '../../core/contracts.js'
import { InvalidCredentialsError, UserAlreadyExistsError } from '../../core/errors.js'
import { ValidationError } from '../../core/errors.js'
import { prisma } from '../../storage/client.js'
import { config } from '../../config/index.js'

const KEY_LEN = 64

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  // Sin formato "salt:hash" no es una contraseña válida (p. ej. placeholders de
  // usuarios auto-creados por IntegrityService) → nunca da match.
  if (!salt || !hash || hash.length !== KEY_LEN * 2) return false
  const candidate = scryptSync(password, salt, KEY_LEN)
  const expected  = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/register — crea usuario y devuelve JWT
  app.post('/auth/register', async (req, reply) => {
    const parsed = RegisterUserSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const { email, alias, password } = parsed.data

    if (await prisma.user.findUnique({ where: { email } })) {
      throw new UserAlreadyExistsError('email', email)
    }
    if (await prisma.user.findUnique({ where: { alias } })) {
      throw new UserAlreadyExistsError('alias', alias)
    }

    const user = await prisma.user.create({
      data: { email, alias, password: hashPassword(password) },
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
  app.post('/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError(parsed.error.flatten())

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (!user || !verifyPassword(parsed.data.password, user.password)) {
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
}
