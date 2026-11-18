// ─── SON1KVERSE — Core Types ──────────────────────────────────────────────────
// Este módulo es el lenguaje común del sistema.
// NUNCA importar desde otros módulos internos aquí.

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum MemoryType {
  LYRICS          = 'lyrics',
  MUSIC_PROMPT    = 'music_prompt',
  VISUAL_CONCEPT  = 'visual_concept',
  STRATEGY        = 'strategy',
  FEEDBACK        = 'feedback',
  PATTERN         = 'pattern',
  REFERENCE       = 'reference',
}

export enum ArtifactType {
  LYRICS         = 'lyrics',
  MUSIC_PROMPT   = 'music_prompt',
  AUDIO_URL      = 'audio_url',
  VISUAL_PROMPT  = 'visual_prompt',
  IMAGE_URL      = 'image_url',
  STRATEGY       = 'strategy',
  HOOK           = 'hook',
}

export enum AgentType {
  LYRICS    = 'lyrics',
  MUSIC     = 'music',
  VISUAL    = 'visual',
  STRATEGY  = 'strategy',
  MEMORY    = 'memory',
}

export enum ProviderType {
  OPENAI       = 'openai',
  OPENROUTER   = 'openrouter',
  OLLAMA       = 'ollama',
  MUSICGEN     = 'musicgen',
  STABLE_AUDIO = 'stable_audio',
  ACE_STEP     = 'ace_step',   // Motor de base musical extrema velocidad (diffusion)
}

export enum Emotion {
  NOSTALGIA        = 'nostalgia',
  MELANCHOLY       = 'melancholy',
  HOPE             = 'hope',
  REBELLION        = 'rebellion',
  DIGITAL_SOLITUDE = 'digital_solitude',
  TRANSCENDENCE    = 'transcendence',
  JOY              = 'joy',
  ANGER            = 'anger',
  LONGING          = 'longing',
  EUPHORIA         = 'euphoria',
}

export enum SessionStatus {
  ACTIVE    = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

// ─── Pixel Personality ───────────────────────────────────────────────────────
// Fuente única: packages/shared-types (importado también por apps/web).

import type { PixelMoodId, PixelTone } from '@son1k/shared-types'
export type { PixelMoodId, PixelTone } from '@son1k/shared-types'

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type BpmRange = {
  min:       number
  max:       number
  preferred: number
}

export type MusicReference = {
  artist:   string
  track?:   string | undefined
  album?:   string | undefined
  elements: string[] // qué tomar de esa referencia: "el reverb largo", "el hook melancólico"
}

export type BrandingConfig = {
  colors?:      string[] | undefined
  fonts?:       string[] | undefined
  keywords:     string[]
  mood:         string
  visualStyle?: string | undefined
}

// ─── Artist Profile ───────────────────────────────────────────────────────────

export type ArtistProfile = {
  id:             string
  userId:         string
  alias:          string
  genres:         string[]
  bpmRange:       BpmRange
  aesthetics:     string[]
  references:     MusicReference[]
  recurringWords: string[]
  emotions:       Emotion[]
  narrative:      string
  vocalStyle?:    string | undefined
  branding?:      BrandingConfig | undefined
  createdAt:      Date
  updatedAt:      Date
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export type MemoryEntry = {
  id:         string
  profileId:  string
  type:       MemoryType
  content:    string
  context?:   Record<string, unknown> | undefined
  embedding?: number[] | undefined
  score:      number   // 0.0 a 1.0 — relevancia aprendida
  tags?:      string[] | undefined
  sessionId?: string | undefined
  createdAt:  Date
  updatedAt:  Date
}

// ─── Creative Intent — Lo que Pixel analiza antes de actuar ──────────────────

export type CreativeIntent = {
  type:           AgentType
  emotion:        Emotion[]
  genre?:         string[] | undefined
  bpm?:           number | undefined
  narrative?:     string | undefined
  urgency:        'low' | 'medium' | 'high'
  outputFormat?:  ArtifactType | undefined
  rawPrompt:      string
  profileContext?: Partial<ArtistProfile> | undefined
  confidence:     number // 0.0 a 1.0
}

// ─── Creative Result ──────────────────────────────────────────────────────────

export type CreativeResult = {
  id:           string
  profileId?:   string | undefined
  sessionId?:   string | undefined
  type:         ArtifactType
  content:      string | Record<string, unknown>
  agentUsed:    AgentType
  modelUsed:    string
  providerUsed: ProviderType
  prompt:       string
  intent:       CreativeIntent
  metadata?:    Record<string, unknown> | undefined
  createdAt:    Date
}

// ─── Agent Context — Lo que recibe cada agente al ejecutarse ─────────────────

export type AgentContext = {
  intent:      CreativeIntent
  profile:     ArtistProfile
  memories:    MemoryEntry[]
  sessionId:   string
  personality?: PixelTone | undefined
  provider?:   unknown
  model?:      string | undefined
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export type Feedback = {
  artifactId: string
  score:      number  // 0.0 = malo, 1.0 = perfecto
  note?:      string | undefined
  tags?:      string[] | undefined
}

// ─── Orchestration Request ────────────────────────────────────────────────────

export type OrchestrationRequest = {
  prompt:    string
  lyrics?:   string
  profileId: string
  sessionId: string
  options?: {
    forceAgent?:    AgentType | undefined
    forceProvider?: ProviderType | undefined
    forceModel?:    string | undefined
    // Audio: duración e idioma del track cuando el agente MUSIC dispara el motor
    durationSeconds?: number | undefined
    language?:        string | undefined
    // Selección de motor de generación (Fase 2 - ACE-Step)
    engine?:          'heartmula' | 'ace_step' | undefined
  } | undefined
}

// ─── Routing Rule — Sistema extensible sin hardcodeo ─────────────────────────

export type RoutingRule = {
  name:      string
  condition: (intent: CreativeIntent) => boolean
  agent:     AgentType
  provider:  ProviderType
  model:     string
  priority:  number  // mayor número = mayor prioridad
}

// ─── Provider Config ──────────────────────────────────────────────────────────

export type ProviderConfig = {
  apiKey?:     string | undefined
  baseUrl?:    string | undefined
  model?:      string | undefined
  timeout?:    number | undefined
  maxRetries?: number | undefined
}

// ─── Completion Options ───────────────────────────────────────────────────────

export type CompletionOptions = {
  temperature?:  number | undefined
  maxTokens?:    number | undefined
  systemPrompt?: string | undefined
  model?:        string | undefined
  [key: string]: unknown
}
