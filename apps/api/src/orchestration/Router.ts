// ─── SON1KVERSE — Router ──────────────────────────────────────────────────────
// Sistema de reglas extensible. Pixel usa el Router para decidir
// agente + provider + modelo. No hay hardcodeo — todo es configurable.

import type { IAgent, IProvider, IRouter } from '../core/interfaces.js'
import type { CreativeIntent, RoutingRule } from '../core/types.js'
import { AgentType, ProviderType } from '../core/types.js'
import { NoAgentAvailableError } from '../core/errors.js'

export class Router implements IRouter {
  private readonly rules:     RoutingRule[] = []
  private readonly agents:    Map<AgentType, IAgent>    = new Map()
  private readonly providers: Map<ProviderType, IProvider> = new Map()

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.type as AgentType, agent)
  }

  registerProvider(type: ProviderType, provider: IProvider): void {
    this.providers.set(type, provider)
  }

  getProvider(type: ProviderType): IProvider | undefined {
    return this.providers.get(type)
  }

  addRule(rule: RoutingRule): void {
    this.rules.push(rule)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  removeRule(name: string): void {
    const idx = this.rules.findIndex(r => r.name === name)
    if (idx !== -1) this.rules.splice(idx, 1)
  }

  listRules(): RoutingRule[] {
    return [...this.rules]
  }

  route(intent: CreativeIntent): { agent: IAgent; provider: IProvider; model: string } {
    // 1. Buscar regla que aplique (ya ordenadas por prioridad)
    const rule = this.rules.find(r => r.condition(intent))

    if (rule) {
      const agent    = this.agents.get(rule.agent)
      const provider = this.providers.get(rule.provider)
      if (agent && provider) {
        return { agent, provider, model: rule.model }
      }
    }

    // 2. Fallback: matching directo por tipo de intención
    const agent = this.agents.get(intent.type as AgentType)
    if (!agent) throw new NoAgentAvailableError(intent.type)

    // 3. Fallback de provider: OpenRouter > Ollama
    const provider =
      this.providers.get(ProviderType.OPENROUTER) ??
      this.providers.get(ProviderType.OLLAMA)

    if (!provider) throw new NoAgentAvailableError('No hay providers disponibles')

    return {
      agent,
      provider,
      model: provider.supportedModels[0] ?? 'unknown',
    }
  }

  // Carga las reglas de routing por defecto
  loadDefaultRules(): void {
    // Reglas especializadas (mayor prioridad)
    this.addRule({
      name:      'lyrics-ollama-low-urgency',
      priority:  20,
      condition: (i) => i.type === AgentType.LYRICS && i.urgency === 'low',
      agent:     AgentType.LYRICS,
      provider:  ProviderType.OLLAMA,
      model:     'qwen2.5:3b',
    })

    // Reglas estándar
    this.addRule({
      name:      'lyrics-openrouter',
      priority:  10,
      condition: (i) => i.type === AgentType.LYRICS,
      agent:     AgentType.LYRICS,
      provider:  ProviderType.OPENROUTER,
      model:     'anthropic/claude-3-haiku',
    })

    this.addRule({
      name:      'music-openrouter',
      priority:  10,
      condition: (i) => i.type === AgentType.MUSIC,
      agent:     AgentType.MUSIC,
      provider:  ProviderType.OPENROUTER,
      model:     'anthropic/claude-3-haiku',
    })

    this.addRule({
      name:      'visual-openrouter',
      priority:  10,
      condition: (i) => i.type === AgentType.VISUAL,
      agent:     AgentType.VISUAL,
      provider:  ProviderType.OPENROUTER,
      model:     'anthropic/claude-3-haiku',
    })

    this.addRule({
      name:      'strategy-openrouter',
      priority:  10,
      condition: (i) => i.type === AgentType.STRATEGY,
      agent:     AgentType.STRATEGY,
      provider:  ProviderType.OPENROUTER,
      model:     'anthropic/claude-3-haiku',
    })
  }
}
