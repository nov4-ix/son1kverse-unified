// ─── SON1KVERSE — Memory Service ─────────────────────────────────────────────

import type { IMemoryService } from '../core/interfaces.js'
import type { MemoryEntry, MemoryType } from '../core/types.js'
import type { SaveMemoryDTO } from '../core/contracts.js'
import { MemoryRepository } from '../storage/repositories/MemoryRepository.js'
import { EmbeddingService } from './EmbeddingService.js'
import { eventBus, SystemEvent } from '../core/events.js'
import { logger } from '../lib/logger.js'

export class MemoryService implements IMemoryService {
  private readonly repo:      MemoryRepository
  private readonly embedding: EmbeddingService

  constructor() {
    this.repo      = new MemoryRepository()
    this.embedding = new EmbeddingService()
  }

  async saveMemory(data: SaveMemoryDTO): Promise<MemoryEntry> {
    // Generar embedding del contenido para búsqueda semántica futura
    const vector  = await this.embedding.embed(data.content)
    const memory  = await this.repo.create(data, vector)

    eventBus.emit(SystemEvent.MEMORY_SAVED, {
      memoryId:  memory.id,
      profileId: memory.profileId,
      type:      memory.type,
      timestamp: new Date(),
    })

    return memory
  }

  // Busca contexto relevante para un prompt dado.
  // Combina búsqueda semántica (embeddings) con score de relevancia.
  async searchContext(query: string, profileId: string, limit = 10): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.embedding.embed(query)
    const allMemories    = await this.repo.findWithEmbeddings(profileId)

    if (allMemories.length === 0) return []

    const candidates = allMemories
      .filter(m => m.embedding !== undefined)
      .map(m => ({ id: m.id, embedding: m.embedding! }))

    const ranked = this.embedding.findMostSimilar(queryEmbedding, candidates, limit * 2)

    // Combinar score semántico con score de relevancia histórica
    const memoryMap = new Map(allMemories.map(m => [m.id, m]))
    const results = ranked
      .map(r => {
        const mem = memoryMap.get(r.id)
        if (!mem) return null
        return { memory: mem, combined: r.score * 0.6 + mem.score * 0.4 }
      })
      .filter((r): r is { memory: MemoryEntry; combined: number } => r !== null)
      .sort((a, b) => b.combined - a.combined)
      .slice(0, limit)
      .map(r => r.memory)

    eventBus.emit(SystemEvent.MEMORY_SEARCHED, { query, profileId, found: results.length })
    return results
  }

  async updateMemory(id: string, score: number): Promise<MemoryEntry> {
    return this.repo.updateScore(id, score)
  }

  async getMemoriesByType(profileId: string, type: MemoryType): Promise<MemoryEntry[]> {
    return this.repo.findByType(profileId, type)
  }

  // Consolidación: elimina memorias de baja relevancia, actualiza scores
  async consolidate(profileId: string): Promise<void> {
    const pruned = await this.repo.pruneByScore(profileId, 0.1)
    eventBus.emit(SystemEvent.MEMORY_CONSOLIDATED, { profileId, pruned, timestamp: new Date() })
    logger.info({ profileId, pruned }, 'Memoria consolidada')
  }

  async deleteMemory(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
