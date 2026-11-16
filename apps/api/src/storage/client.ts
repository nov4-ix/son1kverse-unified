// ─── SON1KVERSE — Prisma Client Singleton ────────────────────────────────────

import { PrismaClient } from '@son1k/db'
import { config } from '../config/index.js'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  })

if (config.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function connectDB(): Promise<void> {
  await prisma.$connect()
  console.log('✓ Database connected')
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect()
}
