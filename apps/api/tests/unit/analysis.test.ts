import { describe, it, expect } from 'vitest'
import { AnalysisService } from '../../src/analysis/AnalysisService.js'
import { AgentType, Emotion, type ArtistProfile } from '../../src/core/index.js'

describe('AnalysisService', () => {
  const mockFailingProvider = {
    complete: async () => {
      throw new Error('Network error to LLM')
    },
  }

  const service = new AnalysisService(mockFailingProvider)

  const sampleProfile: ArtistProfile = {
    id: 'cuid_test_123456789012345678901234',
    userId: 'cuid_user_123456789012345678901234',
    alias: 'nov4-ix',
    genres: ['synthwave', 'cyberpunk'],
    bpmRange: { min: 90, max: 130, preferred: 110 },
    aesthetics: ['neon', 'retrofuturismo'],
    references: [],
    recurringWords: ['digital', 'sombra'],
    emotions: [Emotion.MELANCHOLY, Emotion.DIGITAL_SOLITUDE],
    narrative: 'Historias de identidad y resistencia en un mundo tecnológico.',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('falls back to heuristic analysis when provider fails and preserves profile.id', async () => {
    const intent = await service.analyze(
      'Necesito urgente un beat de música instrumental cyberpunk con sintetizadores oscuros',
      sampleProfile,
    )

    expect(intent.type).toBe(AgentType.MUSIC)
    expect(intent.urgency).toBe('high')
    expect(intent.genre).toContain('cyberpunk')
    expect(intent.profileContext?.id).toBe(sampleProfile.id)
  })

  it('detects visual intent and emotions heuristically', async () => {
    const intent = await service.analyze(
      'Quiero diseñar una portada visual con estética neon para el disco',
      sampleProfile,
    )

    expect(intent.type).toBe(AgentType.VISUAL)
    expect(intent.profileContext?.id).toBe(sampleProfile.id)
  })

  it('detects strategy intent for marketing prompt', async () => {
    const intent = await service.analyze(
      'Cuál es la mejor estrategia de marketing y redes para lanzar el álbum?',
      sampleProfile,
    )

    expect(intent.type).toBe(AgentType.STRATEGY)
  })
})
