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
import { selectPixelTone } from '@son1k/shared-types'
import type { IOrchestrator } from '../core/interfaces.js'
import type { CreativeResult, OrchestrationRequest } from '../core/types.js'
import type { FeedbackDTO } from '../core/contracts.js'
import { AgentType, ArtifactType, MemoryType, ProviderType } from '../core/types.js'
import { ProfileNotFoundError } from '../core/errors.js'
import { eventBus, SystemEvent } from '../core/events.js'
import { AnalysisService } from '../analysis/AnalysisService.js'
import { IdentityService } from '../identity/IdentityService.js'
import { MemoryService } from '../memory/MemoryService.js'
import { ArtifactRepository } from '../storage/repositories/ArtifactRepository.js'
import {
  musicLabClient,
  type MusicLabEngine,
  type MusicLabGenerateParams,
  type MusicLabJob,
} from '../clients/musicLab.js'
import { logger } from '../lib/logger.js'
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

    logger.info('PIXEL inicializado — Sistema Operativo Creativo listo')
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

      // Track encolado en Music Lab, si el agente MUSIC lo disparó
      let audioJobId: string | null = null

      // ─── 5b. MusicAgent → Music Lab (generación real) ─────────────────────
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

          const params: MusicLabGenerateParams = {
            prompt:     this.buildCaption(genre, mood, musical),
            lyrics:     null,
            duration_s: options?.durationSeconds ?? 30,
            bpm:        bpm >= 30 && bpm <= 300 ? bpm : undefined,
            style_tags: this.buildStyleTags(genre, intent.emotion, musical),
            engine:     this.toMusicLabEngine(options?.engine),
            master:     true,
          }

          const accepted = await musicLabClient.generate(params)
          audioJobId = accepted.job_id
          logger.info({ jobId: accepted.job_id }, 'Music Lab encoló generación')

          // Espera SÍNCRONA: el artifact se persiste con el estado FINAL y la
          // ruta real del WAV, no con 'queued'. Si no termina en el timeout, se
          // persiste como 'queued' y el seguimiento en background (paso 6b)
          // sigue intentando hasta que Music Lab resuelva.
          try {
            const finished = await musicLabClient.waitForJob(accepted.job_id, {
              timeoutMs: 2_700_000,
              pollIntervalMs: 3_000,
            })
            const localWav = await this.saveAudioToOutput(accepted.job_id, finished)

            result = {
              ...result,
              type: ArtifactType.AUDIO_URL,
              content: {
                ...musical,
                track_id:    accepted.job_id,
                status:      'done',
                engine_used: finished.result?.engine ?? null,
                mode:        finished.mode,
                local_wav:   localWav,
                result:      finished.result ?? null,
              },
            }
            audioJobId = null // ya resolvió: no hace falta seguimiento en 6b
            logger.info({ jobId: accepted.job_id }, 'Music Lab completó track → artifact done')
          } catch (waitErr) {
            result = {
              ...result,
              type: ArtifactType.AUDIO_URL,
              content: {
                ...musical,
                track_id: accepted.job_id,
                status:   'queued',
                message:  'Generación en curso — seguimiento en background',
              },
            }
            logger.warn(
              { jobId: accepted.job_id, error: waitErr instanceof Error ? waitErr.message : String(waitErr) },
              'Track no terminó a tiempo; se persiste queued y se sigue en background',
            )
          }
        } catch (audioErr) {
          // Fallback: conservar el music_prompt si Music Lab no está disponible
          logger.warn(
            { error: audioErr instanceof Error ? audioErr.message : String(audioErr) },
            'Music Lab no disponible — se guarda music_prompt',
          )
        }
      }

      // ─── 6. Persistir resultado como artifact ─────────────────────────────
      let artifact = await this.artifacts.create(result, profileId, sessionId)

      if (result.type === ArtifactType.AUDIO_URL) {
        result = {
          ...result,
          content: {
            ...(result.content as Record<string, unknown>),
            download_url: this.artifactAudioUrl(artifact.id),
          },
        }
        await this.artifacts.updateContent(artifact.id, result.content)
        artifact = { ...artifact, content: result.content }
      }

      // 6b. Si Music Lab encoló un track, hacerle seguimiento en background:
      // el artifact pasa de 'queued' a 'done' con las rutas del WAV y las
      // métricas reales en cuanto Music Lab termine.
      if (audioJobId) {
        void this.settleAudioTrack(artifact.id, audioJobId)
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

      logger.info(
        { durationMs, agent: agent.type, model: finalModel },
        'Pixel completó orquestación',
      )
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

  private toMusicLabEngine(engine: 'ace_step' | undefined): MusicLabEngine | undefined {
    if (engine === 'ace_step') return 'ace-step'
    return undefined
  }

  private buildCaption(genre: string, mood: string, musical: Record<string, unknown>): string {
    const description = typeof musical.description === 'string' ? musical.description : ''
    return [genre, mood, description]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join('; ')
      .slice(0, 4000)
  }

  private buildStyleTags(
    genre: string,
    emotions: readonly string[],
    musical: Record<string, unknown>,
  ): string[] {
    const tags = new Set<string>()
    tags.add(genre)
    for (const emotion of emotions) {
      if (emotion.trim().length > 0) tags.add(emotion.trim())
    }
    for (const key of ['instruments', 'style_tags', 'styleTags'] as const) {
      const raw = musical[key]
      if (!Array.isArray(raw)) continue
      for (const item of raw) {
        if (typeof item === 'string' && item.trim().length > 0) tags.add(item.trim())
      }
    }
    return [...tags].slice(0, 32)
  }

  private artifactAudioUrl(artifactId: string): string {
    return `/api/v1/artifacts/${encodeURIComponent(artifactId)}/audio`
  }

  // Descarga el audio terminado desde Music Lab y lo guarda en output/tracks/
  // para que haya prueba física en disco de la generación. Best-effort: si
  // falla, el artifact conserva la ruta de descarga autenticada.
  private async saveAudioToOutput(jobId: string, job: MusicLabJob): Promise<string | null> {
    try {
      const audio = await musicLabClient.getAudio(jobId)
      const buf = Buffer.from(audio.buffer)
      const dir = path.join(process.cwd(), 'output', 'tracks')
      await fs.mkdir(dir, { recursive: true })
      const extension = audio.contentType.includes('mpeg') ? 'mp3' : 'wav'
      const file = path.join(dir, `${jobId}.${extension}`)
      await fs.writeFile(file, buf)
      logger.info(
        { jobId, file, status: job.status, bytes: buf.byteLength },
        'WAV guardado en disco',
      )
      return file
    } catch (err) {
      logger.warn(
        { jobId, error: err instanceof Error ? err.message : String(err) },
        'No se pudo guardar el audio del job',
      )
      return null
    }
  }

  // Sigue un track encolado hasta que termine y actualiza el artifact con el
  // resultado real (rutas del WAV, métricas, motor usado). No bloquea la
  // orquestación: corre en background y sus errores sólo se loguean.
  private async settleAudioTrack(artifactId: string, jobId: string): Promise<void> {
    try {
      const job      = await musicLabClient.waitForJob(jobId, {
        timeoutMs: 2_700_000,
        pollIntervalMs: 5_000,
      })
      const localWav = await this.saveAudioToOutput(jobId, job)
      const artifact = await this.artifacts.findById(artifactId)
      const content  = (typeof artifact.content === 'object' && artifact.content !== null)
        ? artifact.content as Record<string, unknown>
        : {}

      await this.artifacts.updateContent(artifactId, {
        ...content,
        status:       'done',
        engine_used:  job.result?.engine ?? null,
        mode:         job.mode,
        local_wav:    localWav,
        result:       job.result ?? null,
        download_url: this.artifactAudioUrl(artifactId),
      })

      logger.info({ jobId, engine: job.result?.engine ?? null }, 'Music Lab completó track')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ jobId, error: message }, 'Seguimiento de track falló')
      try {
        const artifact = await this.artifacts.findById(artifactId)
        const content  = (typeof artifact.content === 'object' && artifact.content !== null)
          ? artifact.content as Record<string, unknown>
          : {}
        await this.artifacts.updateContent(artifactId, {
          ...content,
          status:       'error',
          error:        message,
          download_url: this.artifactAudioUrl(artifactId),
        })
      } catch (updateErr) {
        logger.warn(
          { artifactId, error: updateErr instanceof Error ? updateErr.message : String(updateErr) },
          'No se pudo marcar el artifact como error',
        )
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Orquestación de Coherencia — una sola llamada single-shot a Music Lab
  // ──────────────────────────────────────────────────────────────────────
  async orchestrateCoherentSong(request: OrchestrationRequest): Promise<CreativeResult> {
    const start = Date.now()
    const { prompt, lyrics, profileId, sessionId, options } = request

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
      // usamos valores por defecto para seguir con la generación.
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
        logger.warn(
          { error: agentErr instanceof Error ? agentErr.message : String(agentErr) },
          'Agente MUSIC falló; usando valores por defecto',
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
      const totalDurationSeconds = options?.durationSeconds ?? 180

      const songLyrics = (lyrics ?? '').trim()
      if (!songLyrics) {
        throw new Error('Se requiere letra aprobada para generar una canción coherente')
      }

      // ─── 3. Una sola llamada single-shot: la letra estructurada y los
      // style tags de Pixel A&R viajan completos a ACE-Step (o al motor
      // activo de Music Lab). No hay fragmentos ni concatenación.
      const params: MusicLabGenerateParams = {
        prompt:     this.buildCaption(genre, mood, musical),
        lyrics:     songLyrics,
        duration_s: totalDurationSeconds,
        bpm:        bpm >= 30 && bpm <= 300 ? bpm : undefined,
        key:        typeof musical.key === 'string' ? musical.key : undefined,
        style_tags: this.buildStyleTags(genre, intent.emotion, musical),
        engine:     this.toMusicLabEngine(options?.engine),
        master:     true,
      }

      logger.info(
        { duration_s: totalDurationSeconds, bpm, styleTags: params.style_tags },
        'Canción coherente: llamada single-shot a Music Lab',
      )

      const accepted = await musicLabClient.generate(params)
      const finished = await musicLabClient.waitForJob(accepted.job_id, {
        timeoutMs: 8 * 60 * 60 * 1000,
        pollIntervalMs: 5_000,
      })
      const localWav = await this.saveAudioToOutput(accepted.job_id, finished)
      const trackId = accepted.job_id

      // ─── 4. Construir el CreativeResult ───────────────────────────────
      result = {
        ...result,
        type: ArtifactType.AUDIO_URL,
        content: {
          ...musical,
          track_id:      trackId,
          status:        'done',
          engine_used:   finished.result?.engine ?? null,
          mode:          finished.mode,
          local_wav:     localWav,
          coherent_song: true,
          single_shot:   true,
          result:        finished.result ?? null,
        },
      }

      // ─── 5. Persistir artifact ────────────────────────────────────────
      const artifact = await this.artifacts.create(result, profileId, sessionId)
      result = {
        ...result,
        content: {
          ...(result.content as Record<string, unknown>),
          download_url: this.artifactAudioUrl(artifact.id),
        },
      }
      await this.artifacts.updateContent(artifact.id, result.content)

      // ─── 6. Memoria ───────────────────────────────────────────────────
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

      logger.info(
        { durationMs, trackId, engine: finished.result?.engine ?? null },
        'Pixel (coherente) completó canción single-shot',
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

    logger.info({ artifactId, score }, 'Pixel procesó feedback')
  }
}
