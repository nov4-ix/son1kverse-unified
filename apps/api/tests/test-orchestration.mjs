// ─── End-to-End Orchestration & Feedback Test ─────────────────────────────

import assert from 'node:assert/strict'
import { prisma, connectDB, disconnectDB } from '../dist/storage/client.js'
import { Pixel } from '../dist/orchestration/Pixel.js'
import { AgentType, ProviderType, Emotion } from '../dist/core/types.js'

console.log('⬡ Iniciando prueba E2E de Pixel (Orchestration + Memory + Feedback)...\n')

await connectDB()

const testUser = await prisma.user.create({
  data: {
    email: `test-${Date.now()}@son1kverse.test`,
    alias: `tester_${Date.now()}`,
    password: 'secure_password_hash_12345',
  },
})

const testProfile = await prisma.artistProfile.create({
  data: {
    userId: testUser.id,
    alias: testUser.alias,
    genres: JSON.stringify(['synthwave', 'cyberpunk']),
    bpmRange: JSON.stringify({ min: 100, max: 130, preferred: 118 }),
    aesthetics: JSON.stringify(['neon', 'glitch']),
    references: JSON.stringify([]),
    recurringWords: JSON.stringify(['sombra']),
    emotions: JSON.stringify([Emotion.MELANCHOLY]),
    narrative: 'Explorando la soledad en una megalópolis futurista.',
  },
})

const testSession = await prisma.session.create({
  data: {
    userId: testUser.id,
    profileId: testProfile.id,
    status: 'active',
  },
})

console.log(`✓ Perfil de prueba creado: ${testProfile.alias} (${testProfile.id})`)

import { Router } from '../dist/orchestration/Router.js'
import { LyricsAgent } from '../dist/agents/LyricsAgent.js'
import { MusicAgent } from '../dist/agents/MusicAgent.js'
import { VisualAgent } from '../dist/agents/VisualAgent.js'
import { StrategyAgent } from '../dist/agents/StrategyAgent.js'

const mockProvider = {
  name: 'mock',
  type: ProviderType.OPENROUTER,
  supportedModels: ['anthropic/claude-3-haiku'],
  complete: async () => `[VERSO]\nCaminando en la noche de neón\n[CORO]\nSoledad digital`,
  isAvailable: async () => true,
  configure: () => {},
}

const router = new Router()
router.registerProvider(ProviderType.OPENROUTER, mockProvider)
router.registerAgent(new LyricsAgent(mockProvider))
router.registerAgent(new MusicAgent(mockProvider))
router.registerAgent(new VisualAgent(mockProvider))
router.registerAgent(new StrategyAgent(mockProvider))
router.loadDefaultRules()

const pixel = new Pixel({ router })

// Orquestar
console.log('→ Ejecutando pixel.orchestrate()...')
const result = await pixel.orchestrate({
  prompt: 'Crea una letra synthwave sobre caminar solo de noche',
  profileId: testProfile.id,
  sessionId: testSession.id,
})

assert.ok(result.id, 'El resultado debe tener un ID')
assert.equal(result.profileId, testProfile.id, 'CreativeResult debe contener el profileId')
console.log(`✓ Orquestación completada con éxito. Artifact ID: ${result.id}`)

// Verificar que se guardó en memoria
const savedMemory = await prisma.memory.findFirst({
  where: { profileId: testProfile.id },
  orderBy: { createdAt: 'desc' },
})
assert.ok(savedMemory, 'Debe haberse guardado una memoria para el perfil')
console.log(`✓ Memoria persistida con tipo: ${savedMemory.type}`)

// Probar Feedback
console.log('→ Ejecutando pixel.processFeedback()...')
await pixel.processFeedback({
  artifactId: result.id,
  score: 0.9,
  note: 'increíble atmósfera nostálgica y sintetizadores brillantes',
  tags: ['retrofuturo'],
})

// Verificar evolución del perfil
const updatedProfile = await prisma.artistProfile.findUnique({
  where: { id: testProfile.id },
})

const recurringWords = JSON.parse(updatedProfile.recurringWords)
const aesthetics = JSON.parse(updatedProfile.aesthetics)

assert.ok(recurringWords.includes('atmósfera') || recurringWords.includes('nostálgica'), 'El perfil debe evolucionar con palabras del feedback positivo')
assert.ok(aesthetics.includes('retrofuturo'), 'La estética debe evolucionar con los tags del feedback')
console.log('✓ Feedback procesado y perfil evolucionado correctamente (sin error 404).')

// Limpieza
await prisma.artifact.deleteMany({ where: { profileId: testProfile.id } })
await prisma.memory.deleteMany({ where: { profileId: testProfile.id } })
await prisma.session.deleteMany({ where: { profileId: testProfile.id } })
await prisma.artistProfile.delete({ where: { id: testProfile.id } })
await prisma.user.delete({ where: { id: testUser.id } })

await disconnectDB()

console.log('\n🎉 PRUEBA E2E COMPLETADA CON ÉXITO: TODO EL FLUJO OPERA CORRECTAMENTE.')
