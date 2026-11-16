// ─── SON1KVERSE — Base Agent ──────────────────────────────────────────────────

import type { IAgent, IProvider } from '../../core/interfaces.js'
import type { AgentContext, ArtistProfile, CreativeResult, CreativeIntent } from '../../core/types.js'
import { AgentExecutionError } from '../../core/errors.js'
import { eventBus, SystemEvent } from '../../core/events.js'
import { buildPixelPersonalityPrompt, selectPixelTone } from '../../core/pixel/pixelPersonality.js'
import { randomUUID } from 'crypto'

export abstract class BaseAgent implements IAgent {
  abstract readonly type:           string
  abstract readonly supportedTypes: string[]

  constructor(protected readonly provider: IProvider) {}

  abstract canHandle(intent: CreativeIntent): boolean
  abstract buildSystemPrompt(profile: ArtistProfile): string
  abstract buildUserPrompt(context: AgentContext): string
  abstract formatResult(raw: string, context: AgentContext): CreativeResult

  async execute(context: AgentContext): Promise<CreativeResult> {
    const { intent, profile } = context
    const start = Date.now()

    try {
      const personality = context.personality ?? selectPixelTone(context.intent)
      const systemPrompt = `${this.buildSystemPrompt(profile)}\n\n${buildPixelPersonalityPrompt(personality)}`
      const userPrompt   = this.buildUserPrompt(context)
      const activeProvider = (context.provider as IProvider | undefined) ?? this.provider

      const raw = await activeProvider.complete(userPrompt, {
        systemPrompt,
        temperature: personality.temperature,
        maxTokens:   1200,
        model:       context.model,
      })

      const result = this.formatResult(raw, context)

      eventBus.emit(SystemEvent.AGENT_EXECUTED, {
        agentType:  this.type,
        profileId:  profile.id,
        sessionId:  context.sessionId,
        durationMs: Date.now() - start,
      })

      return result
    } catch (err) {
      eventBus.emit(SystemEvent.AGENT_FAILED, {
        agentType: this.type,
        error:     err instanceof Error ? err.message : String(err),
        sessionId: context.sessionId,
      })
      throw new AgentExecutionError(this.type, err instanceof Error ? err.message : String(err))
    }
  }

  // Construye contexto de memoria como texto inyectable en el prompt
  protected formatMemoryContext(context: AgentContext): string {
    if (context.memories.length === 0) return ''
    const lines = context.memories
      .slice(0, 5)
      .map(m => `- [${m.type}] ${m.content.slice(0, 200)}`)
      .join('\n')
    return `\nContexto de sesiones anteriores:\n${lines}`
  }

  // Construye perfil del artista como texto inyectable
  protected formatProfileContext(profile: ArtistProfile): string {
    return `Artista: ${profile.alias}
Géneros: ${profile.genres.join(', ')}
BPM preferido: ${profile.bpmRange.preferred}
Estética: ${profile.aesthetics.join(', ')}
Narrativa: ${profile.narrative}
Emociones frecuentes: ${profile.emotions.join(', ')}`
  }

  protected newResultId(): string {
    return randomUUID()
  }
}
