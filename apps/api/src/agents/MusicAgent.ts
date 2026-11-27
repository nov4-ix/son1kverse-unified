// ─── SON1KVERSE — Music Agent ─────────────────────────────────────────────────

import { BaseAgent } from './base/BaseAgent.js'
import type { AgentContext, ArtistProfile, CreativeIntent, CreativeResult } from '../core/types.js'
import { AgentType, ArtifactType, ProviderType } from '../core/types.js'

export class MusicAgent extends BaseAgent {
  readonly type           = AgentType.MUSIC
  readonly supportedTypes = [AgentType.MUSIC]

  canHandle(intent: CreativeIntent): boolean {
    return intent.type === AgentType.MUSIC
  }

  buildSystemPrompt(profile: ArtistProfile): string {
    return `Eres un ingeniero de prompts especializado en generación musical.
Tu trabajo es construir prompts técnicamente precisos para ACE-Step 1.5.

Artista: ${profile.alias}
Géneros base: ${profile.genres.join(', ')}
BPM preferido: ${profile.bpmRange.preferred} (rango ${profile.bpmRange.min}-${profile.bpmRange.max})
Estética: ${profile.aesthetics.join(', ')}

REGLAS:
- Los prompts deben describir el sonido, no el concepto.
- Incluye: instrumentos, tempo, atmósfera, dinámica, referencia de producción.
- Para motores locales: puedes incluir estructura, mood y dinámica.
- Responde con JSON válido.`
  }

  buildUserPrompt(context: AgentContext): string {
    const { intent, profile } = context
    const memCtx = this.formatMemoryContext(context)

    return `Crea prompts musicales para: "${intent.rawPrompt}"

Parámetros:
- Emociones target: ${intent.emotion.join(', ')}
- Géneros: ${(intent.genre ?? profile.genres).join(', ')}
- BPM: ${intent.bpm ?? profile.bpmRange.preferred}
${memCtx}

Responde SOLO con este JSON (sin markdown):
{
  "prompt": "prompt detallado con mood, estructura y dinámica",
  "description": "descripción del resultado esperado en español",
  "bpm": 120,
  "key": "Am",
  "instruments": ["synth", "bass", "drums"]
}`
  }

  formatResult(raw: string, context: AgentContext): CreativeResult {
    let content: Record<string, unknown>
    try {
      const clean = raw.replace(/```json\n?|```\n?/g, '').trim()
      content = JSON.parse(clean) as Record<string, unknown>
    } catch {
      // Si no parsea como JSON, guardar como texto plano
      content = { raw, prompt: raw }
    }

    const activeProvider = (context.provider as { type?: string } | undefined) ?? this.provider
    return {
      id:           this.newResultId(),
      profileId:    context.profile.id,
      sessionId:    context.sessionId,
      type:         ArtifactType.MUSIC_PROMPT,
      content,
      agentUsed:    AgentType.MUSIC,
      modelUsed:    context.model ?? this.provider.supportedModels[0] ?? 'unknown',
      providerUsed: (activeProvider.type ?? this.provider.type) as ProviderType,
      prompt:       context.intent.rawPrompt,
      intent:       context.intent,
      createdAt:    new Date(),
    }
  }
}
