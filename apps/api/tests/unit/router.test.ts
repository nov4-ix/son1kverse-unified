import { describe, it, expect, beforeEach } from 'vitest'
import { Router } from '../../src/orchestration/Router.js'
import { AgentType, ProviderType, Emotion } from '../../src/core/types.js'
import type { IAgent, IProvider, CreativeIntent } from '../../src/core/index.js'

describe('Router', () => {
  let router: Router

  const mockProvider = (type: ProviderType): IProvider => ({
    name: type,
    type,
    supportedModels: ['model-1', 'model-2'],
    complete: async () => 'test completion',
    isAvailable: async () => true,
    configure: () => {},
  })

  const mockAgent = (type: AgentType): IAgent => ({
    type,
    supportedTypes: [type],
    canHandle: (intent) => intent.type === type,
    buildSystemPrompt: () => 'prompt',
    execute: async () => ({} as any),
  })

  beforeEach(() => {
    router = new Router()
    router.registerProvider(ProviderType.OPENROUTER, mockProvider(ProviderType.OPENROUTER))
    router.registerProvider(ProviderType.OLLAMA, mockProvider(ProviderType.OLLAMA))

    router.registerAgent(mockAgent(AgentType.LYRICS))
    router.registerAgent(mockAgent(AgentType.MUSIC))
    router.registerAgent(mockAgent(AgentType.VISUAL))
    router.registerAgent(mockAgent(AgentType.STRATEGY))

    router.loadDefaultRules()
  })

  it('routes standard LYRICS to OpenRouter', () => {
    const intent: CreativeIntent = {
      type: AgentType.LYRICS,
      emotion: [Emotion.MELANCHOLY],
      urgency: 'medium',
      rawPrompt: 'escribe una letra nostálgica',
      confidence: 0.9,
    }

    const routed = router.route(intent)
    expect(routed.agent.type).toBe(AgentType.LYRICS)
    expect(routed.provider.type).toBe(ProviderType.OPENROUTER)
    expect(routed.model).toBe('anthropic/claude-3-haiku')
  })

  it('routes low-urgency LYRICS to Ollama (priority rule)', () => {
    const intent: CreativeIntent = {
      type: AgentType.LYRICS,
      emotion: [Emotion.NOSTALGIA],
      urgency: 'low',
      rawPrompt: 'una letra tranquila',
      confidence: 0.8,
    }

    const routed = router.route(intent)
    expect(routed.agent.type).toBe(AgentType.LYRICS)
    expect(routed.provider.type).toBe(ProviderType.OLLAMA)
    expect(routed.model).toBe('qwen2.5:3b')
  })

  it('routes MUSIC intent to MusicAgent', () => {
    const intent: CreativeIntent = {
      type: AgentType.MUSIC,
      emotion: [Emotion.EUPHORIA],
      urgency: 'medium',
      rawPrompt: 'crea un beat de synthwave',
      confidence: 0.95,
    }

    const routed = router.route(intent)
    expect(routed.agent.type).toBe(AgentType.MUSIC)
  })

  it('allows retrieval of registered provider via getProvider', () => {
    const openrouter = router.getProvider(ProviderType.OPENROUTER)
    const ollama = router.getProvider(ProviderType.OLLAMA)

    expect(openrouter?.type).toBe(ProviderType.OPENROUTER)
    expect(ollama?.type).toBe(ProviderType.OLLAMA)
  })
})
