// ─── SON1KVERSE — Bootstrap de ADMIN ─────────────────────────────────────────
// Crea o promueve un usuario ADMIN con cuota de generaciones ilimitada.
// Uso (desde apps/api o con make admin-create):
//   ADMIN_EMAIL=... ADMIN_ALIAS=... ADMIN_PASSWORD=... pnpm admin:create

import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const loadEnvFile = (
  process as typeof process & { loadEnvFile?: (path?: string) => void }
).loadEnvFile
try {
  loadEnvFile?.(fileURLToPath(new URL('../.env', import.meta.url)))
} catch {
  // Sin .env: se usan las variables del entorno.
}

const { prisma } = await import('../src/storage/client.js')
const { SUBSCRIPTION_LIMITS, UNLIMITED_GENERATIONS } = await import('@son1k/shared-types')

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

async function main(): Promise<void> {
  const email = process.env['ADMIN_EMAIL']?.trim()
  const alias = process.env['ADMIN_ALIAS']?.trim()
  const password = process.env['ADMIN_PASSWORD']

  if (!email || !alias || !password) {
    throw new Error('Define ADMIN_EMAIL, ADMIN_ALIAS y ADMIN_PASSWORD.')
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.')
  }

  const passwordHash = await hashPassword(password)
  const storageLimit = BigInt(SUBSCRIPTION_LIMITS.ENTERPRISE.storageLimitBytes)
  const adminData = {
    alias,
    passwordHash,
    role: 'ADMIN' as const,
    subscriptionTier: 'ENTERPRISE' as const,
    generationsLimit: UNLIMITED_GENERATIONS,
    storageLimit,
    isEmailVerified: true,
    isActive: true,
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, ...adminData },
    update: adminData,
  })

  console.log(JSON.stringify({
    id: user.id,
    email: user.email,
    alias: user.alias,
    role: user.role,
    subscriptionTier: user.subscriptionTier,
    generationsLimit: user.generationsLimit,
    storageLimit: user.storageLimit.toString(),
  }, null, 2))
}

try {
  await main()
} catch (error) {
  console.error(`No se pudo crear el ADMIN: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
