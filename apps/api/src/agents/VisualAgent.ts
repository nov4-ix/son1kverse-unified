// ─── SON1KVERSE — Visual Agent ────────────────────────────────────────────────

import { BaseAgent } from './base/BaseAgent.js'
import type { AgentContext, ArtistProfile, CreativeIntent, CreativeResult } from '../core/types.js'
import { AgentType, ArtifactType, ProviderType } from '../core/types.js'

export class VisualAgent extends BaseAgent {
  readonly type           = AgentType.VISUAL
  readonly supportedTypes = [AgentType.VISUAL]

  canHandle(intent: CreativeIntent): boolean {
    return intent.type === AgentType.VISUAL
  }

  buildSystemPrompt(profile: ArtistProfile): string {
    return `Eres un director de arte y branding para "${profile.alias}".
Estética: ${profile.aesthetics.join(', ')}
${profile.branding ? `Colores: ${profile.branding.colors?.join(', ')}, Mood: ${profile.branding.mood}` : ''}

Tu trabajo: crear prompts visuales para modelos de imagen (SDXL, Flux, Midjourney).
Responde con JSON válido, sin markdown.`
  }

  buildUserPrompt(context: AgentContext): string {
    const { intent } = context
    return `Crea un concepto visual para: "${intent.rawPrompt}"

Responde SOLO con JSON:
{
  "concept": "descripción del concepto visual en español",
  "sdxl_prompt": "prompt detallado en inglés para SDXL/Flux",
  "negative_prompt": "elementos a evitar",
  "style_tags": ["tag1", "tag2"],
  "color_palette": ["#color1", "#color2"],
  "mood": "descripción del mood visual"
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
      type:         ArtifactType.VISUAL_PROMPT,
      content,
      agentUsed:    AgentType.VISUAL,
      modelUsed:    context.model ?? this.provider.supportedModels[0] ?? 'unknown',
      providerUsed: (activeProvider.type ?? this.provider.type) as ProviderType,
      prompt:       context.intent.rawPrompt,
      intent:       context.intent,
      createdAt:    new Date(),
    }
  }
}
