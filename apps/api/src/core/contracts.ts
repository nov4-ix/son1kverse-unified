// ─── SON1KVERSE — Core Contracts ─────────────────────────────────────────────
// DTOs con validación Zod. Todo input externo pasa por aquí antes de tocar
// la lógica de negocio. Nunca confiar en datos sin validar.

import { z } from 'zod'
import { AgentType, Emotion, MemoryType, ProviderType } from './types.js'

// ─── Shared schemas ───────────────────────────────────────────────────────────

const BpmRangeSchema = z.object({
  min:       z.number().min(40).max(300),
  max:       z.number().min(40).max(300),
  preferred: z.number().min(40).max(300),
}).refine(data => data.min <= data.preferred && data.preferred <= data.max, {
  message: 'preferred debe estar entre min y max',
})

const MusicReferenceSchema = z.object({
  artist:   z.string().min(1),
  track:    z.string().optional(),
  album:    z.string().optional(),
  elements: z.array(z.string()).min(1, 'Especifica al menos un elemento a tomar de esta referencia'),
})

const BrandingConfigSchema = z.object({
  colors:      z.array(z.string()).optional(),
  fonts:       z.array(z.string()).optional(),
  keywords:    z.array(z.string()).min(1),
  mood:        z.string().min(2),
  visualStyle: z.string().optional(),
})

// ─── Profile DTOs ─────────────────────────────────────────────────────────────

export const CreateProfileSchema = z.object({
  userId:         z.string().cuid(),
  alias:          z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Solo letras, números, guiones y underscores'),
  genres:         z.array(z.string().min(1)).min(1, 'Al menos un género'),
  bpmRange:       BpmRangeSchema,
  aesthetics:     z.array(z.string()).min(1, 'Al menos una estética'),
  references:     z.array(MusicReferenceSchema).default([]),
  narrative:      z.string().min(20, 'La narrativa necesita al menos 20 caracteres'),
  vocalStyle:     z.string().optional(),
  branding:       BrandingConfigSchema.optional(),
  recurringWords: z.array(z.string()).default([]),
  emotions:       z.array(z.nativeEnum(Emotion)).default([]),
})

export type CreateProfileDTO = z.infer<typeof CreateProfileSchema>

export const UpdateProfileSchema = CreateProfileSchema
  .partial()
  .omit({ userId: true })

export type UpdateProfileDTO = z.infer<typeof UpdateProfileSchema>

// ─── Memory DTOs ──────────────────────────────────────────────────────────────

export const SaveMemorySchema = z.object({
  profileId: z.string().cuid(),
  type:      z.nativeEnum(MemoryType),
  content:   z.string().min(1).max(10000),
  context:   z.record(z.unknown()).optional(),
  tags:      z.array(z.string()).optional(),
  sessionId: z.string().cuid().optional(),
})

export type SaveMemoryDTO = z.infer<typeof SaveMemorySchema>

export const SearchMemorySchema = z.object({
  query:     z.string().min(1).max(500),
  profileId: z.string().cuid(),
  type:      z.nativeEnum(MemoryType).optional(),
  limit:     z.number().int().min(1).max(50).default(10),
})

export type SearchMemoryDTO = z.infer<typeof SearchMemorySchema>

// ─── Session DTOs ─────────────────────────────────────────────────────────────

export const CreateSessionSchema = z.object({
  userId:    z.string().cuid(),
  profileId: z.string().cuid(),
  metadata:  z.record(z.unknown()).optional(),
})

export type CreateSessionDTO = z.infer<typeof CreateSessionSchema>

// ─── Orchestration DTOs ───────────────────────────────────────────────────────

export const OrchestrationRequestSchema = z.object({
  prompt:    z.string().min(3).max(2000),
  lyrics:    z.string().optional(),            // letra aprobada (si ya existe)
  profileId: z.string().cuid(),
  sessionId: z.string().cuid(),
  options:   z.object({
    forceAgent:      z.nativeEnum(AgentType).optional(),
    forceProvider:   z.nativeEnum(ProviderType).optional(),
    forceModel:      z.string().optional(),
    durationSeconds: z.number().int().min(10).max(600).optional(),
    language:        z.string().min(2).max(16).optional(),
    // Canción coherente por bloques
    coherentSong:    z.boolean().default(false),
  }).optional(),
})

export type OrchestrationRequestDTO = z.infer<typeof OrchestrationRequestSchema>

// La canción coherente siempre parte de una letra ya aprobada por el artista.
export const CoherentOrchestrationSchema = OrchestrationRequestSchema.extend({
  lyrics: z.string().min(1, 'La letra aprobada es obligatoria'),
})

export const AudioGenerateRequestSchema = z.object({
  genre:            z.string().min(1),
  mood:             z.string().min(1),
  language:         z.string().min(1),
  duration_seconds: z.number().int().min(10).max(600).default(60),
  lyrics:           z.string().optional(),
  // Orquestación de Coherencia — fragmento de letra
  fragment_lyrics:  z.string().optional(),
  seed_audio_path:  z.string().optional(),
  fragment_index:   z.number().int().min(0).optional(),
  total_fragments:  z.number().int().min(1).optional(),
  is_coherent_song: z.boolean().default(false),
  bpm:              z.number().int().min(40).max(250).optional(),
  title:            z.string().optional(),
  structure:        z.array(z.string()).optional(),
  skip_mastering:   z.boolean().default(false),
  skip_analysis:    z.boolean().default(false),
  profileId:        z.string().cuid().optional(),
  sessionId:        z.string().cuid().optional(),
  // Estructura musical por sección (Fase 1 - Coherencia)
  section_name:     z.string().optional(),     // intro, verse, chorus, bridge, outro...
  section_emotion:  z.string().optional(),     // melancholic, energetic, calm...
  section_energy:   z.number().min(0).max(1).optional(), // 0.0 - 1.0

  // Motor de generación: ACE-Step es el único motor GPU soportado.
  engine:           z.literal('ace_step').optional().default('ace_step'),
})

export type AudioGenerateRequestDTO = z.infer<typeof AudioGenerateRequestSchema>

// ─── Feedback DTOs ────────────────────────────────────────────────────────────

export const FeedbackSchema = z.object({
  artifactId:  z.string().cuid(),
  score:       z.number().min(0).max(1),
  note:        z.string().max(500).optional(),
  tags:        z.array(z.string()).optional(),
})

export type FeedbackDTO = z.infer<typeof FeedbackSchema>

// ─── User / Auth DTOs ─────────────────────────────────────────────────────────

export const RegisterUserSchema = z.object({
  email:    z.string().email(),
  alias:    z.string().min(2).max(50),
  password: z.string().min(12, 'Mínimo 12 caracteres'),
})

export type RegisterUserDTO = z.infer<typeof RegisterUserSchema>

export const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

export type LoginDTO = z.infer<typeof LoginSchema>

// ─── API Response Helpers ─────────────────────────────────────────────────────

export type ApiResponse<T> = {
  success: true
  data:    T
  meta?: {
    timestamp: string
    version:   string
    took?:     number  // ms
  }
}

export type ApiError = {
  success: false
  error: {
    code:     string
    message:  string
    details?: unknown
  }
}

export function successResponse<T>(data: T, tookMs?: number): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version:   process.env['SYSTEM_VERSION'] ?? '0.1.0',
      ...(tookMs !== undefined && { took: tookMs }),
    },
  }
}

export function errorResponse(code: string, message: string, details?: unknown): ApiError {
  return {
    success: false,
    error: { code, message, ...(details !== undefined && { details }) },
  }
}
