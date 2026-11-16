// ─── SON1KVERSE — Lyrics Agent ────────────────────────────────────────────────

import { BaseAgent } from './base/BaseAgent.js'
import type { AgentContext, ArtistProfile, CreativeIntent, CreativeResult } from '../core/types.js'
import { AgentType, ArtifactType, ProviderType } from '../core/types.js'

export class LyricsAgent extends BaseAgent {
  readonly type           = AgentType.LYRICS
  readonly supportedTypes = [AgentType.LYRICS]

  canHandle(intent: CreativeIntent): boolean {
    return intent.type === AgentType.LYRICS
  }

  buildSystemPrompt(profile: ArtistProfile): string {
    return `Eres el asistente de composición del artista "${profile.alias}".

${this.formatProfileContext(profile)}

REGLAS:
- Escribe en el estilo y voz del artista, no en el tuyo.
- Usa la narrativa y estética del artista como guía.
- Las letras deben sonar auténticas a su universo creativo.
- Si el artista trabaja con cyberpunk/synthwave, usa vocabulario coherente.
- Prioriza hooks memorables y emotivos sobre la perfección técnica.
- "Lo imperfecto también es sagrado."`
  }

  buildUserPrompt(context: AgentContext): string {
    const { intent, profile } = context
    const memCtx = this.formatMemoryContext(context)

    return `Escribe letras para: "${intent.rawPrompt}"

Parámetros:
- Emociones: ${intent.emotion.join(', ')}
- Géneros: ${(intent.genre ?? profile.genres).join(', ')}
- BPM referencia: ${intent.bpm ?? profile.bpmRange.preferred}
${intent.narrative ? `- Narrativa: ${intent.narrative}` : ''}
${memCtx}

Estructura sugerida: verso, pre-coro, coro, verso 2, coro, bridge, coro final.
Incluye [VERSO], [CORO], [BRIDGE] como marcadores de sección.`
  }

  formatResult(raw: string, context: AgentContext): CreativeResult {
    const activeProvider = (context.provider as { type?: string } | undefined) ?? this.provider
    return {
      id:           this.newResultId(),
      profileId:    context.profile.id,
      sessionId:    context.sessionId,
      type:         ArtifactType.LYRICS,
      content:      raw.trim(),
      agentUsed:    AgentType.LYRICS,
      modelUsed:    context.model ?? this.provider.supportedModels[0] ?? 'unknown',
      providerUsed: (activeProvider.type ?? this.provider.type) as ProviderType,
      prompt:       context.intent.rawPrompt,
      intent:       context.intent,
      createdAt:    new Date(),
    }
  }
}
