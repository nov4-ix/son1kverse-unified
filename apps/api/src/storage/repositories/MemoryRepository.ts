// ─── SON1KVERSE — Memory Repository ──────────────────────────────────────────

import { prisma } from '../client.js'
import type { MemoryEntry, MemoryType } from '../../core/types.js'
import type { SaveMemoryDTO } from '../../core/contracts.js'
import { MemoryNotFoundError } from '../../core/errors.js'

function deserializeMemory(raw: {
  id: string
  profileId: string
  type: string
  content: string
  context: string | null
  embedding: string | null
  score: number
  tags: string | null
  sessionId: string | null
  createdAt: Date
  updatedAt: Date
}): MemoryEntry {
  return {
    id:         raw.id,
    profileId:  raw.profileId,
    type:       raw.type as MemoryType,
    content:    raw.content,
    context:    raw.context ? (JSON.parse(raw.context) as Record<string, unknown>) : undefined,
    embedding:  raw.embedding ? (JSON.parse(raw.embedding) as number[]) : undefined,
    score:      raw.score,
    tags:       raw.tags ? (JSON.parse(raw.tags) as string[]) : undefined,
    sessionId:  raw.sessionId ?? undefined,
    createdAt:  raw.createdAt,
    updatedAt:  raw.updatedAt,
  }
}

export class MemoryRepository {
  async create(data: SaveMemoryDTO, embedding?: number[]): Promise<MemoryEntry> {
    const raw = await prisma.memory.create({
      data: {
        profileId: data.profileId,
        type:      data.type,
        content:   data.content,
        context:   data.context ? JSON.stringify(data.context) : null,
        embedding: embedding ? JSON.stringify(embedding) : null,
        tags:      data.tags ? JSON.stringify(data.tags) : null,
        sessionId: data.sessionId ?? null,
      },
    })
    return deserializeMemory(raw)
  }

  async findById(id: string): Promise<MemoryEntry> {
    const raw = await prisma.memory.findUnique({ where: { id } })
    if (!raw) throw new MemoryNotFoundError(id)
    return deserializeMemory(raw)
  }

  async findByProfile(profileId: string, limit = 50): Promise<MemoryEntry[]> {
    const rows = await prisma.memory.findMany({
      where:   { profileId },
      orderBy: { score: 'desc' },
      take:    limit,
    })
    return rows.map(deserializeMemory)
  }

  async findByType(profileId: string, type: MemoryType, limit = 20): Promise<MemoryEntry[]> {
    const rows = await prisma.memory.findMany({
      where:   { profileId, type },
      orderBy: { score: 'desc' },
      take:    limit,
    })
    return rows.map(deserializeMemory)
  }

  // Devuelve todas las memorias con embedding para búsqueda semántica local
  async findWithEmbeddings(profileId: string): Promise<MemoryEntry[]> {
    const rows = await prisma.memory.findMany({
      where: { profileId, NOT: { embedding: null } },
      orderBy: { score: 'desc' },
      take: 200,
    })
    return rows.map(deserializeMemory)
  }

  async updateScore(id: string, score: number): Promise<MemoryEntry> {
    const raw = await prisma.memory.update({
      where: { id },
      data:  { score: Math.max(0, Math.min(1, score)) },
    })
    return deserializeMemory(raw)
  }

  async delete(id: string): Promise<void> {
    await prisma.memory.delete({ where: { id } })
  }

  // Limpia memorias con score muy bajo (consolidación)
  async pruneByScore(profileId: string, minScore = 0.1): Promise<number> {
    const result = await prisma.memory.deleteMany({
      where: { profileId, score: { lt: minScore } },
    })
    return result.count
  }
}
