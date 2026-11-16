// ─── SON1KVERSE — Analysis Service ───────────────────────────────────────────
// Convierte lenguaje humano en CreativeIntent estructurado.
// Usa el proveedor configurado (OpenRouter / Ollama) para el análisis.

import type { IAnalysisService } from '../core/interfaces.js'
import type { ArtistProfile, CreativeIntent } from '../core/types.js'
import { AgentType, ArtifactType, Emotion } from '../core/types.js'
import { AnalysisFailedError } from '../core/errors.js'
import { eventBus, SystemEvent } from '../core/events.js'
import { config } from '../config/index.js'

// El proveedor se inyecta para evitar acoplamiento
interface LLMProvider {
  complete(prompt: string, options?: { systemPrompt?: string }): Promise<string>
}

export class AnalysisService implements IAnalysisService {
  constructor(private readonly provider: LLMProvider) {}

  async analyze(prompt: string, profile: ArtistProfile): Promise<CreativeIntent> {
    const systemPrompt = this.buildSystemPrompt(profile)
    const userPrompt   = this.buildAnalysisPrompt(prompt)

    try {
      const raw = await this.provider.complete(userPrompt, { systemPrompt })
      const intent = this.parseIntent(raw, prompt, profile)
      eventBus.emit(SystemEvent.INTENT_ANALYZED, { intent, profileId: profile.id })
      return intent
    } catch {
      // Fallback: análisis heurístico local si el provider falla o no devuelve JSON válido
      console.warn('[AnalysisService] Provider falló o no devolvió JSON válido, usando análisis heurístico')
      const intent = await this.heuristicAnalysis(prompt, profile)
      eventBus.emit(SystemEvent.INTENT_ANALYZED, { intent, profileId: profile.id })
      return intent
    }
  }

  async detectEmotion(text: string): Promise<string[]> {
    const lower  = text.toLowerCase()
    const found: string[] = []
    const map: Record<string, string[]> = {
      [Emotion.NOSTALGIA]:        ['nostalgia', 'recuerdo', 'antes', 'pasado', 'extraño'],
      [Emotion.MELANCHOLY]:       ['melancolía', 'tristeza', 'soledad', 'oscuro', 'melancholy', 'sad'],
      [Emotion.HOPE]:             ['esperanza', 'futuro', 'posible', 'luz', 'hope'],
      [Emotion.REBELLION]:        ['rebeldía', 'resistencia', 'romper', 'libre', 'rebel'],
      [Emotion.DIGITAL_SOLITUDE]: ['digital', 'virtual', 'pantalla', 'algoritmo', 'datos'],
      [Emotion.TRANSCENDENCE]:    ['trascendencia', 'infinito', 'cosmos', 'más allá', 'eterno'],
      [Emotion.JOY]:              ['alegría', 'feliz', 'celebrar', 'joy', 'happy'],
      [Emotion.ANGER]:            ['rabia', 'enojo', 'furia', 'anger', 'rage'],
      [Emotion.LONGING]:          ['anhelo', 'deseo', 'querer', 'buscar', 'longing'],
      [Emotion.EUPHORIA]:         ['euforia', 'adrenalina', 'intenso', 'euphoria'],
    }
    for (const [emotion, keywords] of Object.entries(map)) {
      if (keywords.some(k => lower.includes(k))) found.push(emotion)
    }
    return found.length > 0 ? found : [Emotion.MELANCHOLY]
  }

  async inferGenre(prompt: string, profile: ArtistProfile): Promise<string[]> {
    const lower   = prompt.toLowerCase()
    const genres  = [...profile.genres]
    const genreMap: Record<string, string[]> = {
      synthwave:    ['synthwave', 'retro', 'años 80', '80s', 'neon'],
      cyberpunk:    ['cyberpunk', 'futuro', 'digital', 'tech', 'neon'],
      'dark pop':   ['oscuro', 'dark', 'sombrío', 'pop oscuro'],
      ambient:      ['ambiente', 'paisaje', 'soundscape', 'ambiental', 'instrumental'],
      'lo-fi':      ['lo-fi', 'chill', 'relajado', 'estudio'],
    }
    for (const [genre, keywords] of Object.entries(genreMap)) {
      if (keywords.some(k => lower.includes(k)) && !genres.includes(genre)) {
        genres.unshift(genre)
      }
    }
    return genres.slice(0, 4)
  }

  async detectUrgency(text: string): Promise<'low' | 'medium' | 'high'> {
    const lower = text.toLowerCase()
    if (['urgente', 'rápido', 'ya', 'ahora', 'hoy', 'inmediato'].some(w => lower.includes(w)))
      return 'high'
    if (['necesito', 'quiero', 'hacer', 'crear'].some(w => lower.includes(w)))
      return 'medium'
    return 'low'
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildSystemPrompt(profile: ArtistProfile): string {
    return `Eres un analizador de intención creativa para el artista "${profile.alias}".
Su identidad: géneros=${profile.genres.join(', ')}, estética=${profile.aesthetics.join(', ')}.
Narrativa: ${profile.narrative}

Analiza el prompt y responde SOLO con JSON válido, sin markdown, sin explicación:
{
  "type": "lyrics|music|visual|strategy",
  "emotions": ["emotion1", "emotion2"],
  "genre": ["genre1"],
  "bpm": 120,
  "narrative": "descripción breve",
  "urgency": "low|medium|high",
  "outputFormat": "lyrics|music_prompt|visual_prompt|hook|strategy",
  "confidence": 0.9
}`
  }

  private buildAnalysisPrompt(prompt: string): string {
    return `Analiza esta solicitud creativa: "${prompt}"`
  }

  private parseIntent(raw: string, originalPrompt: string, profile: ArtistProfile): CreativeIntent {
    try {
      const clean   = raw.replace(/```json\n?|```\n?/g, '').trim()
      // LLM schema uses "emotions"; CreativeIntent maps it to "emotion"
      const parsed  = JSON.parse(clean) as Partial<CreativeIntent> & { emotions?: Emotion[] }
      return {
        type:           (parsed.type as AgentType) ?? AgentType.LYRICS,
        emotion:        (parsed.emotions ?? []) as Emotion[],
        genre:          parsed.genre ?? profile.genres.slice(0, 2),
        bpm:            parsed.bpm ?? profile.bpmRange.preferred,
        narrative:      parsed.narrative,
        urgency:        parsed.urgency ?? 'medium',
        outputFormat:   parsed.outputFormat as ArtifactType,
        rawPrompt:      originalPrompt,
        profileContext: { id: profile.id, alias: profile.alias, genres: profile.genres, aesthetics: profile.aesthetics },
        confidence:     typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      }
    } catch {
      throw new AnalysisFailedError('No se pudo parsear la respuesta del LLM')
    }
  }

  // Análisis heurístico local — no requiere API
  private async heuristicAnalysis(prompt: string, profile: ArtistProfile): Promise<CreativeIntent> {
    const lower    = prompt.toLowerCase()
    const emotions = await this.detectEmotion(prompt)
    const genre    = await this.inferGenre(prompt, profile)
    const urgency  = await this.detectUrgency(prompt)

    let type = AgentType.LYRICS
    if (['música', 'beat', 'instrumental', 'audio', 'sonido'].some(w => lower.includes(w))) type = AgentType.MUSIC
    if (['imagen', 'visual', 'portada', 'logo', 'diseño'].some(w => lower.includes(w)))     type = AgentType.VISUAL
    if (['estrategia', 'marketing', 'post', 'contenido', 'redes'].some(w => lower.includes(w))) type = AgentType.STRATEGY

    return {
      type,
      emotion:   emotions as Emotion[],
      genre,
      bpm:       profile.bpmRange.preferred,
      urgency,
      rawPrompt: prompt,
      profileContext: { id: profile.id, alias: profile.alias, genres: profile.genres, aesthetics: profile.aesthetics },
      confidence: 0.5,
    }
  }
}
