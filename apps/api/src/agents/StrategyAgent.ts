// ─── SON1KVERSE — Strategy Agent ─────────────────────────────────────────────
// Base del nova-post-pilot (pipeline 8 fases) adaptado como agente.

import { BaseAgent } from './base/BaseAgent.js'
import type { AgentContext, ArtistProfile, CreativeIntent, CreativeResult } from '../core/types.js'
import { AgentType, ArtifactType, ProviderType } from '../core/types.js'

export class StrategyAgent extends BaseAgent {
  readonly type           = AgentType.STRATEGY
  readonly supportedTypes = [AgentType.STRATEGY]

  canHandle(intent: CreativeIntent): boolean {
    return intent.type === AgentType.STRATEGY
  }

  buildSystemPrompt(profile: ArtistProfile): string {
    return `Eres el estratega de marketing y contenido de "${profile.alias}".
Géneros: ${profile.genres.join(', ')}
Narrativa: ${profile.narrative}
Estética: ${profile.aesthetics.join(', ')}

Tu misión: construir estrategias de contenido auténticas que amplifiquen la identidad del artista.
No genérico. Todo debe sonar como ${profile.alias}.
Responde con JSON válido, sin markdown.`
  }

  buildUserPrompt(context: AgentContext): string {
    const { intent } = context
    return `Crea una estrategia de contenido para: "${intent.rawPrompt}"

Responde SOLO con JSON:
{
  "objective": "objetivo principal de la campaña",
  "posts": [
    {
      "platform": "instagram|tiktok|twitter",
      "type": "reel|post|story|tweet",
      "caption": "texto del post",
      "hashtags": ["#tag1"],
      "cta": "call to action"
    }
  ],
  "calendar": "frecuencia sugerida de publicación",
  "hook": "gancho principal de la campaña",
  "tone": "tono de comunicación"
}`
  }

  formatResult(raw: string, context: AgentContext): CreativeResult {
    let content: Record<string, unknown>
    try {
      content = JSON.parse(raw.replace(/```json\n?|```\n?/g, '').trim()) as Record<string, unknown>
    } catch {
      content = { raw }
    }
    const activeProvider = (context.provider as { type?: string } | undefined) ?? this.provider
    return {
      id:           this.newResultId(),
      profileId:    context.profile.id,
      sessionId:    context.sessionId,
      type:         ArtifactType.STRATEGY,
      content,
      agentUsed:    AgentType.STRATEGY,
      modelUsed:    context.model ?? this.provider.supportedModels[0] ?? 'unknown',
      providerUsed: (activeProvider.type ?? this.provider.type) as ProviderType,
      prompt:       context.intent.rawPrompt,
      intent:       context.intent,
      createdAt:    new Date(),
    }
  }
}
