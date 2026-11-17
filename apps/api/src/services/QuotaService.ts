// ─── SON1KVERSE — Cuota mensual de generaciones ──────────────────────────────
// Reset mensual: la primera generación de un mes calendario (UTC) reinicia el
// contador a 0 y lo incrementa a 1 en la misma sentencia atómica.
//
// El UPDATE ... WHERE ... RETURNING evita carreras entre requests concurrentes:
// PostgreSQL bloquea la fila y solo incrementa si queda cupo (o si el usuario
// es ADMIN y ADMIN_UNLIMITED=true). Si no devuelve fila, la cuota se agotó.

import { prisma } from '../storage/client.js'
import { config } from '../config/index.js'
import { NotFoundError, QuotaExceededError } from '../core/errors.js'

export type QuotaState = {
  used: number
  limit: number
  unlimited: boolean
}

type QuotaRow = {
  generationsUsedThisMonth: number
  generationsLimit: number
  isAdmin: boolean
}

export async function consumeGenerationQuota(userId: string): Promise<QuotaState> {
  const rows = await prisma.$queryRaw<QuotaRow[]>`
    UPDATE "User"
    SET
      "generationsUsedThisMonth" = CASE
        WHEN "generationsResetAt" IS NULL
          OR "generationsResetAt" < date_trunc('month', now())
        THEN 1
        ELSE "generationsUsedThisMonth" + 1
      END,
      "generationsResetAt" = CASE
        WHEN "generationsResetAt" IS NULL
          OR "generationsResetAt" < date_trunc('month', now())
        THEN now()
        ELSE "generationsResetAt"
      END
    WHERE "id" = ${userId}
      AND (
        (${config.ADMIN_UNLIMITED} AND "role" = 'ADMIN')
        OR "generationsResetAt" IS NULL
        OR "generationsResetAt" < date_trunc('month', now())
        OR "generationsUsedThisMonth" < "generationsLimit"
      )
    RETURNING
      "generationsUsedThisMonth",
      "generationsLimit",
      ("role" = 'ADMIN') AS "isAdmin"
  `

  const row = rows[0]
  if (row !== undefined) {
    return {
      used: row.generationsUsedThisMonth,
      limit: row.generationsLimit,
      unlimited: row.isAdmin && config.ADMIN_UNLIMITED,
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { generationsLimit: true },
  })
  if (user === null) throw new NotFoundError('Usuario no encontrado')
  throw new QuotaExceededError(user.generationsLimit)
}

export async function refundGenerationQuota(userId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "User"
    SET "generationsUsedThisMonth" = GREATEST("generationsUsedThisMonth" - 1, 0)
    WHERE "id" = ${userId}
  `
}
