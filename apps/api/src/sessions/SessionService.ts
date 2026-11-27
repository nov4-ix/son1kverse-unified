// ─── SON1KVERSE — Session Service ────────────────────────────────────────────
// Una sesión agrupa artefactos de un ArtistProfile. El userId sale del JWT y
// se valida contra el dueño del perfil antes de crear.

import type { ISessionService } from '../core/interfaces.js'
import type { CreateSessionDTO } from '../core/contracts.js'
import { SessionStatus } from '../core/types.js'
import { ForbiddenError, ProfileNotFoundError, SessionNotFoundError } from '../core/errors.js'
import { prisma } from '../storage/client.js'

export type SessionRecord = {
  id:        string
  userId:    string
  profileId: string
  status:    string
  metadata:  Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function deserializeSession(raw: {
  id:        string
  userId:    string
  profileId: string
  status:    string
  metadata:  string | null
  createdAt: Date
  updatedAt: Date
}): SessionRecord {
  return {
    id:        raw.id,
    userId:    raw.userId,
    profileId: raw.profileId,
    status:    raw.status,
    metadata:  parseMetadata(raw.metadata),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
}

export class SessionService implements ISessionService {
  async createSession(data: CreateSessionDTO): Promise<SessionRecord> {
    const profile = await prisma.artistProfile.findUnique({
      where: { id: data.profileId },
      select: { userId: true },
    })
    if (profile === null) throw new ProfileNotFoundError(data.profileId)
    if (profile.userId !== data.userId) throw new ForbiddenError()

    const raw = await prisma.session.create({
      data: {
        userId:    data.userId,
        profileId: data.profileId,
        metadata:  data.metadata ? JSON.stringify(data.metadata) : null,
      },
    })
    return deserializeSession(raw)
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const raw = await prisma.session.findUnique({ where: { id } })
    return raw === null ? null : deserializeSession(raw)
  }

  async closeSession(id: string): Promise<void> {
    const existing = await prisma.session.findUnique({ where: { id } })
    if (existing === null) throw new SessionNotFoundError(id)
    if (existing.status !== SessionStatus.ACTIVE) return

    await prisma.session.update({
      where: { id },
      data:  { status: SessionStatus.COMPLETED },
    })
  }
}
