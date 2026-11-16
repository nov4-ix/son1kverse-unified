// ─── Verification suite for SON1KVERSE ─────────────────────────────────────────

import assert from 'node:assert/strict'
import { EmbeddingService } from '../dist/memory/EmbeddingService.js'
import { Router } from '../dist/orchestration/Router.js'
import { AnalysisService } from '../dist/analysis/AnalysisService.js'
import { AgentType, ProviderType, Emotion, ArtifactType } from '../dist/core/types.js'

console.log('⬡ Iniciando suite de verificación SON1KVERSE...\n')

// ─── 1. Test EmbeddingService ────────────────────────────────────────────────
console.log('→ [1/3] Probando EmbeddingService (Vectorizador determinista)...')
const embedding = new EmbeddingService()

const v1 = await embedding.embed('hook melancólico synthwave')
const v2 = await embedding.embed('un texto mucho más largo con múltiples palabras y referencias sobre soledad digital en un futuro cyberpunk')
const vEmpty = await embedding.embed('')

assert.equal(v1.length, 128, 'El vector 1 debe tener dimensión 128')
assert.equal(v2.length, 128, 'El vector 2 debe tener dimensión 128')
assert.equal(vEmpty.length, 128, 'El vector vacío debe tener dimensión 128')

const simIdentical = embedding.similarity(v1, v1)
assert.ok(simIdentical > 0.99, `Similitud idéntica debe ser ~1.0 (fue ${simIdentical})`)

const vQuery = await embedding.embed('melancolía digital y sintetizadores')
const vRelated = await embedding.embed('sintetizadores oscuros con aire de melancolía')
const vUnrelated = await embedding.embed('receta de cocina italiana para pasta al pesto')

const simRel = embedding.similarity(vQuery, vRelated)
const simUnrel = embedding.similarity(vQuery, vUnrelated)

assert.ok(simRel > 0.3, `Textos afines deben tener similitud positiva (fue ${simRel})`)
assert.ok(simRel > simUnrel, `Textos afines deben tener mayor similitud que textos no relacionados (${simRel} vs ${simUnrel})`)

const candidates = [
  { id: 'cocina', embedding: vUnrelated },
  { id: 'synth', embedding: vRelated },
]
const ranked = embedding.findMostSimilar(vQuery, candidates, 2)
assert.equal(ranked[0]?.id, 'synth', 'El candidato más similar debe ser "synth"')
console.log('  ✓ EmbeddingService funciona correctamente (128d, FNV-1a, n-grams, ranking).\n')

// ─── 2. Test Router ──────────────────────────────────────────────────────────
console.log('→ [2/3] Probando Router (Prioridades y Reglas dinámicas)...')
const router = new Router()

const mockProvider = (type) => ({
  name: type,
  type,
  supportedModels: ['default-model'],
  complete: async () => 'ok',
  isAvailable: async () => true,
  configure: () => {},
})

const mockAgent = (type) => ({
  type,
  supportedTypes: [type],
  canHandle: (intent) => intent.type === type,
  buildSystemPrompt: () => 'prompt',
  execute: async () => ({}),
})

router.registerProvider(ProviderType.OPENROUTER, mockProvider(ProviderType.OPENROUTER))
router.registerProvider(ProviderType.OLLAMA, mockProvider(ProviderType.OLLAMA))
router.registerAgent(mockAgent(AgentType.LYRICS))
router.registerAgent(mockAgent(AgentType.MUSIC))
router.registerAgent(mockAgent(AgentType.VISUAL))
router.registerAgent(mockAgent(AgentType.STRATEGY))
router.loadDefaultRules()

// LYRICS con urgencia normal -> OpenRouter
const routeNormal = router.route({
  type: AgentType.LYRICS,
  emotion: [Emotion.MELANCHOLY],
  urgency: 'medium',
  rawPrompt: 'letra triste',
  confidence: 0.9,
})
assert.equal(routeNormal.provider.type, ProviderType.OPENROUTER, 'Urgencia media debe rutear a OpenRouter')

// LYRICS con urgencia baja -> Ollama (prioridad 20 vs 10)
const routeLowUrgency = router.route({
  type: AgentType.LYRICS,
  emotion: [Emotion.NOSTALGIA],
  urgency: 'low',
  rawPrompt: 'letra relax',
  confidence: 0.8,
})
assert.equal(routeLowUrgency.provider.type, ProviderType.OLLAMA, 'Urgencia baja debe rutear a Ollama')
assert.equal(routeLowUrgency.model, 'qwen2.5:3b', 'Modelo debe ser qwen2.5:3b')

// getProvider debe funcionar
assert.ok(router.getProvider(ProviderType.OPENROUTER), 'getProvider debe retornar el provider registrado')
console.log('  ✓ Router resuelve prioridades y providers correctamente.\n')

// ─── 3. Test AnalysisService ─────────────────────────────────────────────────
console.log('→ [3/3] Probando AnalysisService (Heurística y preservación de profileId)...')
const failingProvider = {
  complete: async () => { throw new Error('Simulated LLM offline') },
}
const analysis = new AnalysisService(failingProvider)

const sampleProfile = {
  id: 'cuid_test_123',
  userId: 'user_123',
  alias: 'nov4-ix',
  genres: ['synthwave', 'cyberpunk'],
  bpmRange: { min: 90, max: 130, preferred: 110 },
  aesthetics: ['neon'],
  references: [],
  recurringWords: ['digital'],
  emotions: [Emotion.MELANCHOLY],
  narrative: 'Historias de resistencia en un mundo digital.',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const musicIntent = await analysis.analyze('Necesito un beat instrumental urgente', sampleProfile)
assert.equal(musicIntent.type, AgentType.MUSIC, 'Debe detectar tipo MUSIC')
assert.equal(musicIntent.urgency, 'high', 'Debe detectar urgencia HIGH')
assert.equal(musicIntent.profileContext?.id, 'cuid_test_123', 'profileContext DEBE preservar profile.id')

const visualIntent = await analysis.analyze('Quiero diseñar la portada visual con colores neon', sampleProfile)
assert.equal(visualIntent.type, AgentType.VISUAL, 'Debe detectar tipo VISUAL')
assert.equal(visualIntent.profileContext?.id, 'cuid_test_123', 'profileContext DEBE preservar profile.id')

console.log('  ✓ AnalysisService extrae intenciones y preserva profile.id para evitar errores 404.\n')

console.log('🎉 TODOS LOS TESTS DE VERIFICACIÓN PASARON EXITOSAMENTE (3/3).')
