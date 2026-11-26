// ─── Cuota de almacenamiento (bytes) ────────────────────────────────────────
// Reserva y libera bytes en User.storageUsedBytes usando el storageLimit que
// ya replica SUBSCRIPTION_LIMITS. El UPDATE condicional es atómico: si dos
// jobs compiten por el último espacio, solo uno reserva.

import { prisma } from '../storage/client.js'

export async function reserveStorageBytes(userId: string, bytes: number): Promise<boolean> {
  if (!Number.isFinite(bytes) || bytes <= 0) return true
  const size = BigInt(Math.ceil(bytes))
  const rows = await prisma.$queryRaw<Array<{ storageUsedBytes: bigint }>>`
    UPDATE "User"
    SET "storageUsedBytes" = "storageUsedBytes" + ${size}
    WHERE "id" = ${userId}
      AND "storageUsedBytes" + ${size} <= "storageLimit"
    RETURNING "storageUsedBytes"
  `
  return rows.length > 0
}

export async function releaseStorageBytes(userId: string, bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return
  const size = BigInt(Math.ceil(bytes))
  await prisma.$executeRaw`
    UPDATE "User"
    SET "storageUsedBytes" = GREATEST("storageUsedBytes" - ${size}, 0)
    WHERE "id" = ${userId}
  `
}
