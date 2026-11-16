import { describe, expect, it } from 'vitest'
import { buildPixelPersonalityPrompt, selectPixelMood, selectPixelTone } from '../../src/core/pixel/pixelPersonality.js'

describe('pixelPersonality', () => {
  it('selects the poetic mood for nostalgic emotions', () => {
    const tone = selectPixelTone({ emotion: ['nostalgia'], urgency: 'low' })

    expect(tone.moodId).toBe('poetic')
    expect(tone.temperature).toBe(0.9)
  })

  it('selects the motivational mood for hopeful emotions', () => {
    const mood = selectPixelMood({ emotion: ['hope'], urgency: 'medium' })

    expect(mood.id).toBe('motivational')
    expect(mood.temperature).toBe(0.85)
  })

  it('selects the rebellious mood for high urgency', () => {
    const mood = selectPixelMood({ emotion: [], urgency: 'high' })

    expect(mood.id).toBe('rebellious')
    expect(mood.temperature).toBe(0.95)
  })

  it('falls back to casual technical without strong signals', () => {
    const mood = selectPixelMood({ emotion: [], urgency: 'medium' })

    expect(mood.id).toBe('casual-technical')
    expect(mood.temperature).toBe(0.75)
  })

  it('builds an orchestrator directive instead of chatbot dialogue', () => {
    const prompt = buildPixelPersonalityPrompt(
      selectPixelTone({ emotion: ['nostalgia'], urgency: 'low' }),
    )

    expect(prompt).toContain('No eres un chatbot')
    expect(prompt).toContain('entrega solo el artefacto')
    expect(prompt).not.toContain('Ok bro')
  })
})
