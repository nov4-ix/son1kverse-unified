// ─── SON1KVERSE — Artifact Repository ────────────────────────────────────────

import { prisma } from '../client.js'
import type { ArtifactType, CreativeIntent, CreativeResult, ProviderType, AgentType } from '../../core/types.js'
import { ArtifactNotFoundError } from '../../core/errors.js'

function deserializeArtifact(raw: {
  id: string
  profileId: string
  sessionId: string | null
  type: string
  content: string
  agentUsed: string
  modelUsed: string
  providerUsed: string
  prompt: string
  intent: string | null
  feedback: number | null
  feedbackNote: string | null
  createdAt: Date
}): CreativeResult {
  return {
    id:           raw.id,
    profileId:    raw.profileId,
    sessionId:    raw.sessionId ?? undefined,
    type:         raw.type as ArtifactType,
    content:      JSON.parse(raw.content) as string | Record<string, unknown>,
    agentUsed:    raw.agentUsed as AgentType,
    modelUsed:    raw.modelUsed,
    providerUsed: raw.providerUsed as ProviderType,
    prompt:       raw.prompt,
    intent:       raw.intent ? (JSON.parse(raw.intent) as CreativeIntent) : ({} as CreativeIntent),
    createdAt:    raw.createdAt,
  }
}

export class ArtifactRepository {
  async create(result: CreativeResult, profileId: string, sessionId?: string): Promise<CreativeResult> {
    const raw = await prisma.artifact.create({
      data: {
        id:           result.id,
        profileId,
        sessionId:    sessionId ?? null,
        type:         result.type,
        content:      JSON.stringify(result.content),
        agentUsed:    result.agentUsed,
        modelUsed:    result.modelUsed,
        providerUsed: result.providerUsed,
        prompt:       result.prompt,
        intent:       JSON.stringify(result.intent),
      },
    })
    return deserializeArtifact(raw)
  }

  async findById(id: string): Promise<CreativeResult> {
    const raw = await prisma.artifact.findUnique({ where: { id } })
    if (!raw) throw new ArtifactNotFoundError(id)
    return deserializeArtifact(raw)
  }

  async findByProfile(profileId: string, limit = 20): Promise<CreativeResult[]> {
    const rows = await prisma.artifact.findMany({
      where:   { profileId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })
    return rows.map(deserializeArtifact)
  }

  async saveFeedback(id: string, score: number, note?: string): Promise<void> {
    await prisma.artifact.update({
      where: { id },
      data:  { feedback: score, feedbackNote: note ?? null },
    })
  }

  // Actualiza el contenido de un artifact (p. ej. cuando el Audio Engine
  // termina y el estado pasa de 'queued' a 'done' con las rutas del WAV).
  async updateContent(id: string, content: Record<string, unknown> | string): Promise<void> {
    await prisma.artifact.update({
      where: { id },
      data:  { content: JSON.stringify(content) },
    })
  }
}
