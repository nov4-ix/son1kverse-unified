import { describe, it, expect } from 'vitest'
import { EmbeddingService } from '../../src/memory/EmbeddingService.js'

describe('EmbeddingService', () => {
  const service = new EmbeddingService()

  it('generates vectors with consistent dimension of 128', async () => {
    const v1 = await service.embed('hook melancólico synthwave')
    const v2 = await service.embed('un texto mucho más largo con múltiples palabras y referencias sobre soledad digital en un futuro cyberpunk')
    const vEmpty = await service.embed('')

    expect(v1).toHaveLength(128)
    expect(v2).toHaveLength(128)
    expect(vEmpty).toHaveLength(128)
  })

  it('calculates high cosine similarity for identical or near-identical texts', async () => {
    const v1 = await service.embed('soledad digital en la red')
    const v2 = await service.embed('soledad digital en la red')

    const sim = service.similarity(v1, v2)
    expect(sim).toBeGreaterThan(0.99)
  })

  it('calculates positive similarity for semantically/lexically related texts', async () => {
    const vQuery = await service.embed('melancolía digital y sintetizadores')
    const vCandidate = await service.embed('sintetizadores oscuros con aire de melancolía')
    const vUnrelated = await service.embed('pastel de fresa con crema dulce')

    const simRelated = service.similarity(vQuery, vCandidate)
    const simUnrelated = service.similarity(vQuery, vUnrelated)

    expect(simRelated).toBeGreaterThan(0.4)
    expect(simRelated).toBeGreaterThan(simUnrelated)
  })

  it('ranks most similar candidates correctly', async () => {
    const query = await service.embed('hook melancólico synthwave')
    const candidates = [
      { id: '1', embedding: await service.embed('receta de cocina italiana tradicional') },
      { id: '2', embedding: await service.embed('hook melancólico para synthwave nocturno') },
      { id: '3', embedding: await service.embed('baterías acústicas de jazz clásico') },
    ]

    const ranked = service.findMostSimilar(query, candidates, 2)
    expect(ranked.length).toBeGreaterThanOrEqual(1)
    expect(ranked[0]?.id).toBe('2')
  })
})
