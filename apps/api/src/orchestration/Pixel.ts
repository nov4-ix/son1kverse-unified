// ─── SON1KVERSE — PIXEL ───────────────────────────────────────────────────────
//
// Pixel es el sistema operativo creativo.
// No genera contenido — dirige, orquesta y aprende.
//
// Flujo:
// 1. Analizar solicitud → CreativeIntent
// 2. Consultar memoria creativa
// 3. Consultar perfil artístico
// 4. Elegir agente + modelo via Router
// 5. Ejecutar agente con contexto completo
// 6. Guardar resultado en memoria
// 7. Aprender del feedback
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { IOrchestrator } from '../core/interfaces.js'
import type { CreativeResult, OrchestrationRequest } from '../core/types.js'
import type { FeedbackDTO } from '../core/contracts.js'
import { AgentType, ArtifactType, MemoryType, ProviderType } from '../core/types.js'
import { ProfileNotFoundError } from '../core/errors.js'
import { eventBus, SystemEvent } from '../core/events.js'
import { selectPixelTone } from '../core/pixel/pixelPersonality.js'
import { AnalysisService } from '../analysis/AnalysisService.js'
import { IdentityService } from '../identity/IdentityService.js'
import { MemoryService } from '../memory/MemoryService.js'
import { ArtifactRepository } from '../storage/repositories/ArtifactRepository.js'
import { audioEngineClient } from '../services/AudioEngineClient.js'
import { Router } from './Router.js'
import { OpenRouterProvider } from '../providers/OpenRouterProvider.js'
import { OllamaProvider } from '../providers/OllamaProvider.js'
import { LyricsAgent } from '../agents/LyricsAgent.js'
import { MusicAgent } from '../agents/MusicAgent.js'
import { VisualAgent } from '../agents/VisualAgent.js'
import { StrategyAgent } from '../agents/StrategyAgent.js'
import { config } from '../config/index.js'

export type PixelDependencies = {
  router?:    Router
  analysis?:  AnalysisService
  identity?:  IdentityService
  memory?:    MemoryService
  artifacts?: ArtifactRepository
}

export class Pixel implements IOrchestrator {
  readonly router:    Router
  readonly analysis:  AnalysisService
  readonly identity:  IdentityService
  readonly memory:    MemoryService
  readonly artifacts: ArtifactRepository

  constructor(deps?: PixelDependencies) {
    if (deps?.router) {
      this.router = deps.router
    } else {
      // Inicializar providers por defecto
      const openrouter = new OpenRouterProvider()
      const ollama     = new OllamaProvider()

      // Inicializar router
      this.router = new Router()
      this.router.registerProvider(ProviderType.OPENROUTER, openrouter)
      this.router.registerProvider(ProviderType.OLLAMA, ollama)

      // Registrar agentes
      this.router.registerAgent(new LyricsAgent(openrouter))
      this.router.registerAgent(new MusicAgent(openrouter))
      this.router.registerAgent(new VisualAgent(openrouter))
      this.router.registerAgent(new StrategyAgent(openrouter))

      // Cargar reglas de routing por defecto
      this.router.loadDefaultRules()
    }

    const defaultProvider = this.router.getProvider(ProviderType.OPENROUTER) ?? new OpenRouterProvider()
    this.analysis  = deps?.analysis  ?? new AnalysisService(defaultProvider)
    this.identity  = deps?.identity  ?? new IdentityService()
    this.memory    = deps?.memory    ?? new MemoryService()
    this.artifacts = deps?.artifacts ?? new ArtifactRepository()

    console.log('⬡  PIXEL inicializado — Sistema Operativo Creativo listo')
  }

  async orchestrate(request: OrchestrationRequest): Promise<CreativeResult> {
    const start = Date.now()
    const { prompt, profileId, sessionId, options } = request

    eventBus.emit(SystemEvent.ORCHESTRATION_STARTED, {
      sessionId, profileId, prompt, timestamp: new Date(),
    })

    try {
      // ─── 1. Cargar perfil artístico ───────────────────────────────────────
      const profile = await this.identity.getProfile(profileId)

      // ─── 2. Buscar contexto de memoria ───────────────────────────────────
      const memories = await this.memory.searchContext(
        prompt,
        profileId,
        config.MAX_MEMORY_CONTEXT,
      )

      // ─── 3. Analizar intención creativa ───────────────────────────────────
      const intent = await this.analysis.analyze(prompt, profile)

      // Aplicar overrides si el usuario los especificó
      if (options?.forceAgent)  intent.type = options.forceAgent

      const personality = selectPixelTone(intent)

      // ─── 4. Seleccionar agente + provider vía Router ─────────────────────
      const { agent, provider, model } = this.router.route(intent)

      // Override de provider o modelo si el usuario lo especificó
      const finalProvider = options?.forceProvider
        ? this.router.getProvider(options.forceProvider) ?? provider
        : provider
      const finalModel = options?.forceModel ?? model

      eventBus.emit(SystemEvent.AGENT_SELECTED, {
        sessionId,
        agentType:    agent.type as AgentType,
        providerType: finalProvider.type as ProviderType,
        model:        finalModel,
        intent,
        personality:  personality.moodId,
      })

      // ─── 5. Ejecutar agente con contexto completo ─────────────────────────
      let result = await agent.execute({
        intent,
        profile,
        memories,
        sessionId,
        personality,
        provider: finalProvider,
        model:    finalModel,
      })

      // Track encolado en el Audio Engine, si el agente MUSIC lo disparó
      let audioTrackId: string | null = null

      // ─── 5b. MusicAgent → Audio Engine (generación real) ─────────────────
      if (agent.type === AgentType.MUSIC) {
        try {
          const musical = (typeof result.content === 'object' && result.content !== null)
            ? result.content as Record<string, unknown>
            : {}

          const genre = String(
            (Array.isArray(intent.genre) && intent.genre[0])
              ?? profile.genres[0]
              ?? 'electronic',
          )
          const mood = intent.emotion.length > 0
            ? intent.emotion.join(', ')
            : String(musical.description ?? 'atmospheric')
          const bpmRaw = typeof musical.bpm === 'number'
            ? musical.bpm
            : (intent.bpm ?? profile.bpmRange.preferred)
          // Pydantic valida `bpm` como entero: un decimal del LLM devolvería 422.
          const bpm = Math.round(bpmRaw)

          const job = await audioEngineClient.generate({
            genre,
            mood,
            language:         options?.language ?? 'es',
            duration_seconds: options?.durationSeconds ?? 30,
            bpm:              bpm >= 40 && bpm <= 250 ? bpm : undefined,
            title:            prompt.slice(0, 80),
            lyrics:           null,
            structure:        Array.isArray(musical.instruments)
              ? (musical.instruments as string[])
              : null,
            engine: options?.engine,
          })

          audioTrackId = job.track_id
          const download_url = `/api/v1/audio/download/${encodeURIComponent(job.track_id)}`
          console.log(`⬡  Audio Engine encoló track ${job.track_id}`)

          // Espera SÍNCRONA: el artifact se persiste con el estado FINAL y la
          // URL real del WAV, no con 'queued'. Si no termina en el timeout, se
          // persiste como 'queued' y el seguimiento en background (paso 6b)
          // sigue intentando hasta que el motor resuelva.
          try {
            const finished = await audioEngineClient.waitForCompletion(job.track_id, 2_700_000, 3_000)
            const localWav = await this.saveTrackToOutput(job.track_id)

            result = {
              ...result,
              type: ArtifactType.AUDIO_URL,
              content: {
                ...musical,
                track_id:     job.track_id,
                download_url,
                status:       'done',
                engine_used:  finished.result?.engine_used ?? null,
                local_wav:    localWav,
                result:       finished.result ?? null,
              },
            }
            audioTrackId = null // ya resolvió: no hace falta seguimiento en 6b
            console.log(`⬡  Audio Engine completó track ${job.track_id} → artifact en estado done`)
          } catch (waitErr) {
            result = {
              ...result,
              type: ArtifactType.AUDIO_URL,
              content: {
                ...musical,
                track_id:     job.track_id,
                download_url,
                status:       'queued',
                message:      'Generación en curso — seguimiento en background',
              },
            }
            console.warn(
              `[Pixel] Track ${job.track_id} no terminó a tiempo (${waitErr instanceof Error ? waitErr.message : String(waitErr)}) — se persiste 'queued' y se sigue en background`,
            )
          }
        } catch (audioErr) {
          // Fallback: conservar el music_prompt si el motor no está disponible
          console.warn(
            '[Pixel] Audio Engine no disponible — se guarda music_prompt:',
            audioErr instanceof Error ? audioErr.message : String(audioErr),
          )
        }
      }

      // ─── 6. Persistir resultado como artifact ─────────────────────────────
      const artifact = await this.artifacts.create(result, profileId, sessionId)

      // 6b. Si el Audio Engine encoló un track, hacerle seguimiento en
      // background: el artifact pasa de 'queued' a 'done' con las rutas del WAV
      // y las métricas reales en cuanto el motor termine.
      if (audioTrackId) {
        void this.settleAudioTrack(artifact.id, audioTrackId)
      }

      // ─── 7. Guardar en memoria para futuras sesiones ──────────────────────
      const contentStr = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content)

      const memoryTypeMap: Record<string, MemoryType> = {
        [AgentType.LYRICS]:   MemoryType.LYRICS,
        [AgentType.MUSIC]:    MemoryType.MUSIC_PROMPT,
        [AgentType.VISUAL]:   MemoryType.VISUAL_CONCEPT,
        [AgentType.STRATEGY]: MemoryType.STRATEGY,
      }

      await this.memory.saveMemory({
        profileId,
        type:      memoryTypeMap[agent.type] ?? MemoryType.PATTERN,
        content:   `[${result.type}] ${prompt} → ${contentStr.slice(0, 300)}`,
        sessionId,
        tags:      intent.genre ?? [],
        context:   { agentUsed: result.agentUsed, model: finalModel },
      })

      const durationMs = Date.now() - start
      eventBus.emit(SystemEvent.ORCHESTRATION_COMPLETED, {
        sessionId, result, durationMs, timestamp: new Date(),
      })

      console.log(`⬡  Pixel completó en ${durationMs}ms — agente: ${agent.type}, modelo: ${finalModel}`)
      return result

    } catch (err) {
      eventBus.emit(SystemEvent.ORCHESTRATION_FAILED, {
        sessionId,
        error:     err instanceof Error ? err.message : String(err),
        prompt,
        timestamp: new Date(),
      })
      throw err
    }
  }

  // Descarga el WAV terminado desde el motor y lo guarda en output/tracks/
  // para que haya prueba física en disco de la generación. Best-effort: si
  // falla, el artifact conserva la download_url del proxy.
  private async saveTrackToOutput(trackId: string): Promise<string | null> {
    try {
      const res = await fetch(audioEngineClient.getDownloadUrl(trackId), {
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) {
        console.warn(`⬡  [Pixel] Descarga de ${trackId} respondió HTTP ${res.status}`)
        return null
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const dir = path.join(process.cwd(), 'output', 'tracks')
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, `${trackId}.wav`)
      await fs.writeFile(file, buf)
      console.log(`⬡  [Pixel] WAV guardado en ${file} (${(buf.byteLength / 1024).toFixed(1)} KB)`)
      return file
    } catch (err) {
      console.warn(`⬡  [Pixel] No se pudo guardar el WAV de ${trackId}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  // Sigue un track encolado hasta que termine y actualiza el artifact con el
  // resultado real (rutas del WAV, métricas, motor usado). No bloquea la
  // orquestación: corre en background y sus errores sólo se loguean.
  private async settleAudioTrack(artifactId: string, trackId: string): Promise<void> {
    try {
      const job      = await audioEngineClient.waitForCompletion(trackId, 2_700_000, 3_000)
      const localWav = await this.saveTrackToOutput(trackId)
      const artifact = await this.artifacts.findById(artifactId)
      const content  = (typeof artifact.content === 'object' && artifact.content !== null)
        ? artifact.content as Record<string, unknown>
        : {}

      await this.artifacts.updateContent(artifactId, {
        ...content,
        status:       job.status,
        engine_used:  job.result?.engine_used ?? null,
        local_wav:    localWav,
        result:       job.result ?? null,
        download_url: `/api/v1/audio/download/${encodeURIComponent(trackId)}`,
      })

      const engineUsed = job.result?.engine_used
      if (engineUsed && engineUsed !== 'heartmula') {
        console.warn(
          `⬡  [Pixel] Track ${trackId} generado con fallback sintético (${engineUsed}) — no es inferencia HeartMuLa`,
        )
      } else {
        console.log(`⬡  Audio Engine completó track ${trackId}`)
      }
    } catch (err) {
      console.warn(
        `⬡  [Pixel] Seguimiento de track ${trackId} falló: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Orquestación de Coherencia — canción completa por bloques de ≤15s
  // ──────────────────────────────────────────────────────────────────────
  async orchestrateCoherentSong(request: OrchestrationRequest & { externalTrackId?: string }): Promise<CreativeResult> {
    const start = Date.now()
    const { prompt, lyrics, profileId, sessionId, options, externalTrackId } = request

    eventBus.emit(SystemEvent.ORCHESTRATION_STARTED, {
      sessionId, profileId, prompt, timestamp: new Date(),
    })

    try {
      // ─── 1. Perfil, memoria e intención ────────────────────────────────
      const profile = await this.identity.getProfile(profileId)
      const memories = await this.memory.searchContext(
        prompt, profileId, config.MAX_MEMORY_CONTEXT,
      )
      const intent = await this.analysis.analyze(prompt, profile)

      if (options?.forceAgent)  intent.type = options.forceAgent

      const personality = selectPixelTone(intent)
      const { agent, provider, model } = this.router.route(intent)
      const finalProvider = options?.forceProvider
        ? this.router.getProvider(options.forceProvider) ?? provider
        : provider
      const finalModel = options?.forceModel ?? model

      eventBus.emit(SystemEvent.AGENT_SELECTED, {
        sessionId, agentType: agent.type as AgentType,
        providerType: finalProvider.type as ProviderType, model: finalModel, intent,
        personality: personality.moodId,
      })

      // ─── 2. Contenido musical del agente (género, mood, estructura…) ───
      // Si el agente falla (p. ej. OPENROUTER_API_KEY no configurada),
      // usamos valores por defecto para seguir con la orquesta de coherencia.
      let result: CreativeResult = {
        id: crypto.randomUUID(),
        profileId,
        sessionId,
        type: ArtifactType.MUSIC_PROMPT,
        content: {},
        agentUsed: AgentType.MUSIC,
        modelUsed: finalModel,
        providerUsed: finalProvider.type as ProviderType,
        prompt,
        intent,
        createdAt: new Date(),
      }
      let musical: Record<string, unknown> = {}
      try {
        const agentResult = await agent.execute({
          intent, profile, memories, sessionId, personality,
          provider: finalProvider, model: finalModel,
        })
        musical = (typeof agentResult.content === 'object' && agentResult.content !== null)
          ? agentResult.content as Record<string, unknown>
          : {}
      } catch (agentErr) {
        console.warn(
          '⬡  [Coherente] Agente MUSIC falló (' +
          (agentErr instanceof Error ? agentErr.message : String(agentErr)) +
          '), usando valores por defecto',
        )
      }

      const genre = String(
        (Array.isArray(intent.genre) && intent.genre[0])
          ?? profile.genres[0] ?? 'electronic',
      )
      const mood = intent.emotion.length > 0
        ? intent.emotion.join(', ')
        : String(musical.description ?? 'atmospheric')
      const bpmRaw = typeof musical.bpm === 'number'
        ? (musical.bpm as number)
        : (intent.bpm ?? profile.bpmRange.preferred)
      const bpm = Math.round(bpmRaw)
      const totalDurationSeconds = options?.durationSeconds ?? 180 // 3 min por defecto

      const songLyrics = (lyrics ?? '').trim()
      if (!songLyrics) {
        throw new Error('Se requiere letra aprobada para generar una canción coherente')
      }

      // ─── 3. Segmentar letra en secciones musicales (Intro, Verse, Chorus…) ─
      const sections = splitLyricsIntoSections(songLyrics, totalDurationSeconds)
      const totalFragments = sections.length
      console.log(`⬡  [Coherente] ${totalFragments} secciones para "${prompt.slice(0,60)}"`)

      // ─── 4. Bucle secuencial con semilla del fragmento anterior ─────────
      const fragmentWavPaths: string[] = []
      let prevWavPath: string | null = null

      for (let i = 0; i < totalFragments; i++) {
        const section = sections[i]!
        const fragment = section.lyrics.trim()
        const sectionBpm = section.bpm_offset != null ? Math.round(bpm + section.bpm_offset) : bpm
        const sectionDuration = Math.max(10, Math.min(60, section.duration_s))

        console.log(
          `⬡  [Coherente] Sección ${i + 1}/${totalFragments} "${section.name}" ` +
          `(~${sectionDuration}s, mood=${section.emotion}, energy=${section.energy}) — "${fragment.slice(0,50)}"`
        )

        // Selección de motor: 'heartmula' (por defecto) o 'ace_step' (extrema velocidad)
        const engine = (options?.engine as 'heartmula' | 'ace_step' | undefined) ?? 'heartmula'

        const job = await audioEngineClient.generate({
          genre,
          mood: section.emotion || mood,
          language: options?.language ?? 'es',
          duration_seconds: sectionDuration,
          fragment_lyrics: fragment,
          seed_audio_path: prevWavPath,
          fragment_index: i,
          total_fragments: totalFragments,
          is_coherent_song: true,
          bpm: sectionBpm >= 40 && sectionBpm <= 250 ? sectionBpm : undefined,
          title: `${prompt.slice(0, 60)} [${section.name}]`,
          section_name: section.name,
          section_emotion: section.emotion,
          section_energy: section.energy,
          engine,
          skip_mastering: true,
          skip_analysis: true,
        })

        const finished = await audioEngineClient.waitForCompletion(
          job.track_id, 8 * 60 * 60 * 1000, 3_000, // 8 horas por fragmento en CPU (tiempo ilimitado para el cliente vía polling)
        )
        const localWav = await this.saveTrackToOutput(job.track_id)
        if (localWav) {
          fragmentWavPaths.push(localWav)
          prevWavPath = localWav // semilla para el siguiente bloque
        }
      }

      if (fragmentWavPaths.length === 0) {
        throw new Error('No se generó ningún fragmento de audio')
      }

      // ─── 5. Concatenar todos los fragmentos en una canción final ───────
      const concatenated = await audioEngineClient.concatenate(
        fragmentWavPaths,
        `${prompt.slice(0, 40)}_coherent_${Date.now()}.wav`,
      )

      // ─── 6. Guardar WAV final en output/tracks/ del backend Node ──────
      const trackId = externalTrackId ?? `coherent_${Date.now().toString(36)}`
      const finalBuf = Buffer.from(concatenated.buffer)
      const dir = path.join(process.cwd(), 'output', 'tracks')
      await fs.mkdir(dir, { recursive: true })
      const finalFile = path.join(dir, `${trackId}.wav`)
      await fs.writeFile(finalFile, finalBuf)

      const download_url = `/api/v1/audio/download/${encodeURIComponent(trackId)}`

      // ─── 7. Construir el CreativeResult ───────────────────────────────
      result = {
        ...result,
        type: ArtifactType.AUDIO_URL,
        content: {
          ...musical,
          track_id: trackId,
          download_url,
          status: 'done',
          engine_used: 'heartmula',
          local_wav: finalFile,
          fragments: totalFragments,
          fragment_paths: fragmentWavPaths,
          final_path: finalFile,
          coherent_song: true,
          result: {
            fragments: totalFragments,
            fragment_paths: fragmentWavPaths,
            final_path: finalFile,
            coherent_song: true,
          },
        },
      }

      // ─── 8. Persistir artifact ────────────────────────────────────────
      const artifact = await this.artifacts.create(result, profileId, sessionId)

      // ─── 9. Memoria ───────────────────────────────────────────────────
      const contentStr = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content)

      await this.memory.saveMemory({
        profileId,
        type: MemoryType.MUSIC_PROMPT,
        content: `[${result.type}] ${prompt} → ${contentStr.slice(0, 300)}`,
        sessionId,
        tags: intent.genre ?? [],
        context: { agentUsed: result.agentUsed, model: finalModel, coherent_song: true },
      })

      const durationMs = Date.now() - start
      eventBus.emit(SystemEvent.ORCHESTRATION_COMPLETED, {
        sessionId, result, durationMs, timestamp: new Date(),
      })

      console.log(
        `⬡  Pixel (coherente) completó en ${durationMs}ms — ${totalFragments} fragmentos → ${trackId}`,
      )
      return result

    } catch (err) {
      eventBus.emit(SystemEvent.ORCHESTRATION_FAILED, {
        sessionId, error: err instanceof Error ? err.message : String(err),
        prompt, timestamp: new Date(),
      })
      throw err
    }
  }

  async processFeedback(feedback: FeedbackDTO): Promise<void> {
    const { artifactId, score, note, tags } = feedback

    // Actualizar feedback del artifact
    await this.artifacts.saveFeedback(artifactId, score, note)

    // Recuperar artifact para saber a qué perfil pertenece
    const artifact = await this.artifacts.findById(artifactId)

    const targetProfileId = artifact.profileId ?? artifact.intent.profileContext?.id
    if (!targetProfileId) {
      throw new ProfileNotFoundError(`Artifact ${artifactId} has no associated profile`)
    }

    // Evolucionar el perfil artístico según el feedback
    await this.identity.evolveFromFeedback(
      targetProfileId,
      { artifactId, score, note, tags },
    )

    eventBus.emit(SystemEvent.FEEDBACK_RECEIVED, {
      artifactId, score, note, timestamp: new Date(),
    })

    console.log(`⬡  Pixel procesó feedback: ${artifactId} → score ${score}`)
  }
}

/**
 * Estructura de una sección musical para la orquestación coherente.
 */
interface SongSection {
  name:           string   // intro, verse, chorus, bridge, outro, pre_chorus, post_chorus
  duration_s:     number   // duración objetivo en segundos
  emotion:        string   // melancholic, energetic, calm, aggressive, hopeful...
  bpm_offset:     number   // variación de BPM respecto al base
  energy:         number   // 0.0 (suave) a 1.0 (energético)
  lyrics_hint:    string   // tipo de letra esperada
  lyrics:         string   // letras asignadas a esta sección
}

/**
 * Estructura estándar de canción pop/electrónica (duraciones en segundos).
 */
const DEFAULT_STRUCTURE: SongSection[] = [
  { name: 'intro',        duration_s: 8,  emotion: 'calm',        bpm_offset: 0,   energy: 0.4, lyrics_hint: 'instrumental', lyrics: '' },
  { name: 'verse_1',      duration_s: 16, emotion: 'melancholic', bpm_offset: 0,   energy: 0.6, lyrics_hint: 'narrativa',    lyrics: '' },
  { name: 'pre_chorus',   duration_s: 8,  emotion: 'tense',       bpm_offset: 2,   energy: 0.8, lyrics_hint: 'preparación',  lyrics: '' },
  { name: 'chorus',       duration_s: 16, emotion: 'energetic',   bpm_offset: 0,   energy: 1.0, lyrics_hint: 'gancho',       lyrics: '' },
  { name: 'verse_2',      duration_s: 16, emotion: 'melancholic', bpm_offset: 0,   energy: 0.6, lyrics_hint: 'narrativa',    lyrics: '' },
  { name: 'chorus',       duration_s: 16, emotion: 'energetic',   bpm_offset: 0,   energy: 1.0, lyrics_hint: 'gancho',       lyrics: '' },
  { name: 'bridge',       duration_s: 8,  emotion: 'aggressive',  bpm_offset: -4,  energy: 0.9, lyrics_hint: 'cambio',       lyrics: '' },
  { name: 'outro',        duration_s: 12, emotion: 'calm',        bpm_offset: 0,   energy: 0.3, lyrics_hint: 'desvanecimiento', lyrics: '' },
]

const SECTION_PATTERN = /^\[(\w+)\]$/i

const VOCAL_SECTION_NAMES = new Set([
  'verse', 'chorus', 'bridge', 'pre_chorus', 'post_chorus', 'outro'
])

/**
 * Divide una letra en secciones musicales basándose en marcadores [Verse], [Chorus], etc.
 * Si no hay marcadores, reparte la letra equitativamente entre las secciones vocales.
 * Cada sección recibe su duración, emoción y energía definidas en DEFAULT_STRUCTURE,
 * escaladas a la duración total objetivo.
 */
function splitLyricsIntoSections(lyrics: string, totalDurationSeconds: number): SongSection[] {
  const sections = DEFAULT_STRUCTURE.map(s => ({ ...s, lyrics: '' }))

  // Escalar duraciones proporcionalmente al total objetivo
  const totalStd = DEFAULT_STRUCTURE.reduce((sum, s) => sum + s.duration_s, 0)
  const ratio = totalDurationSeconds / totalStd
  for (const s of sections) {
    s.duration_s = Math.max(4, Math.round(s.duration_s * ratio))
  }

  const lines = lyrics.trim().split(/\n/).filter(Boolean)
  if (lines.length === 0) return sections

  // Detectar si hay marcadores de sección [Nombre]
  const hasMarkers = lines.some(l => SECTION_PATTERN.test(l.trim()))

  if (!hasMarkers) {
    // Repartir equitativamente entre secciones vocales
    const vocalIdx = sections
      .map((s, i) => ({ idx: i, name: s.name.toLowerCase() }))
      .filter(x => VOCAL_SECTION_NAMES.has(x.name))
      .map(x => x.idx)

    if (vocalIdx.length === 0) {
      // Si no hay secciones vocales, usar todas
      vocalIdx.push(...sections.map((_, i) => i))
    }

    const n = vocalIdx.length
    const per = Math.max(1, Math.floor(lines.length / n))
    for (let k = 0; k < n; k++) {
      const idx = vocalIdx[k]
      if (idx === undefined) continue
      const start = k * per
      const end = k === n - 1 ? lines.length : Math.min(lines.length, (k + 1) * per)
      const section = sections[idx]
      if (section) {
        section.lyrics = lines.slice(start, end).join('\n')
      }
    }
    return sections
  }

  // Hay marcadores: asignar líneas a la sección correspondiente
  let currentSection = sections[0]?.name?.toLowerCase() ?? 'intro'
  const sectionMap: Record<string, string[]> = {}

  for (const line of lines) {
    const match = SECTION_PATTERN.test(line.trim())
    if (match) {
      currentSection = line.trim().slice(1, -1).toLowerCase()
    } else {
      if (!sectionMap[currentSection]) sectionMap[currentSection] = []
      const arr = sectionMap[currentSection]
      if (arr) arr.push(line)
    }
  }

  for (const s of sections) {
    s.lyrics = (sectionMap[s.name] ?? []).join('\n')
  }

  return sections
}
