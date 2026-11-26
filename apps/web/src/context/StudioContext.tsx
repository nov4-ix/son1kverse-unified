import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  api,
  ApiError,
  isGenerationResult,
  jobAudioUrl,
  type GenerationHistoryItem,
  type JobStatus,
  type MusicCapabilities,
  type MusicJob,
  type QualityPreset,
} from '../lib/api'
import { useAuth } from './AuthContext'
import { orchestrateAandR } from '../lib/pixelAandR'
import {
  composeLiteraryPrompt,
  DEFAULT_KNOBS,
  knobsToStyleTags,
  signalForJob,
  signalForKnobs,
  type LiteraryKnobs,
} from '@son1k/shared-types'

export type ConsoleView = 'generator' | 'ghost' | 'nova'
export type ReleaseDraft = { id: string; title: string; caption: string; jobId: string; audioUrl: string; createdAt: string }

const DEFAULT_CAPABILITIES: MusicCapabilities = {
  active_engine: 'simulation',
  methods: ['generate', 'repaint', 'cover', 'stems'],
  supports_stems: true,
  active_methods: ['generate', 'repaint', 'cover', 'stems'],
}

type StudioContextValue = {
  view: ConsoleView
  setView: (v: ConsoleView) => void
  knobs: LiteraryKnobs
  setKnob: (k: keyof LiteraryKnobs, v: number) => void
  pixelSignal: string
  job: MusicJob | null
  jobStatus: JobStatus | 'idle'
  lastAudioPath: string | null
  lastJobId: string | null
  lastAudioUrl: string | null
  busy: boolean
  error: string | null
  releases: ReleaseDraft[]
  capabilities: MusicCapabilities
  generations: GenerationHistoryItem[]
  generationsLoading: boolean
  refreshGenerations: () => Promise<void>
  generate: (input: { prompt: string; lyrics: string; qualityPreset?: QualityPreset }) => Promise<void>
  repaint: (input: { prompt: string; start_s: number; end_s: number; qualityPreset?: QualityPreset }) => Promise<void>
  cover: (input: { prompt: string; qualityPreset?: QualityPreset }) => Promise<void>
  splitStems: (input: { prompt: string }) => Promise<void>
  addRelease: (title: string, caption: string) => void
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ConsoleView>('generator')
  const [knobs, setKnobs] = useState<LiteraryKnobs>(DEFAULT_KNOBS)
  const [pixelSignal, setPixelSignal] = useState('A&R Pixel activo // Cuida tu ruido')
  const [job, setJob] = useState<MusicJob | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | 'idle'>('idle')
  const [lastAudioPath, setLastAudioPath] = useState<string | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [releases, setReleases] = useState<ReleaseDraft[]>([])
  const [capabilities, setCapabilities] = useState<MusicCapabilities>(DEFAULT_CAPABILITIES)
  const [generations, setGenerations] = useState<GenerationHistoryItem[]>([])
  const [generationsLoading, setGenerationsLoading] = useState(false)
  const { token, logout } = useAuth()

  const refreshGenerations = useCallback(async () => {
    if (!token) {
      setGenerations([])
      return
    }
    setGenerationsLoading(true)
    try {
      const page = await api.listGenerations({ limit: 20, offset: 0 }, token)
      setGenerations(page.items)
    } catch {
      // mantiene el estado actual si falla temporalmente
    } finally {
      setGenerationsLoading(false)
    }
  }, [token])

  useEffect(() => {
    let active = true
    void api.getMusicCapabilities()
      .then((caps) => {
        if (active) setCapabilities(caps)
      })
      .catch(() => {
        if (active) setCapabilities(DEFAULT_CAPABILITIES)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void refreshGenerations()
  }, [refreshGenerations])

  const setKnob = useCallback((key: keyof LiteraryKnobs, value: number) => {
    setKnobs((curr) => {
      const next = { ...curr, [key]: value }
      setPixelSignal(signalForKnobs(next))
      return next
    })
  }, [])

  const runJob = useCallback(async (start: () => Promise<{ job_id: string }>, arBanner?: string) => {
    setBusy(true); setError(null); setJobStatus('queued'); setPixelSignal(arBanner ?? signalForJob('queued'))
    try {
      const accepted = await start()
      setLastJobId(accepted.job_id)
      const finished = await api.pollJob(accepted.job_id, token, (tick) => {
        setJob(tick); setJobStatus(tick.status)
        if (tick.status !== 'queued') setPixelSignal(signalForJob(tick.status))
      })
      setJob(finished); setJobStatus(finished.status)
      if (finished.status === 'failed') { setError(finished.error?.message ?? 'Job fallido'); return }
      if (isGenerationResult(finished.result)) { setLastAudioPath(finished.result.audio_path); setLastJobId(finished.job_id) }
      setPixelSignal(signalForJob(finished.status))
      void refreshGenerations()
    } catch (cause) {
      setJobStatus('failed')
      if (cause instanceof ApiError && cause.status === 401) {
        logout()
        setError('Sesión vencida. Entra de nuevo y seguimos donde quedamos.')
      } else if (cause instanceof ApiError && (cause.status === 429 || cause.code === 'QUOTA_EXCEEDED')) {
        setError('Cuota agotada. Ni una nota más este mes: cambia de plan o espera el reset.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Error de red')
      }
      setPixelSignal(signalForJob('failed'))
    } finally { setBusy(false) }
  }, [logout, refreshGenerations, token])

  const generate = useCallback(async (input: { prompt: string; lyrics: string; qualityPreset?: QualityPreset }) => {
    const dir = orchestrateAandR(input.prompt, input.lyrics, knobs, releases.length)
    await runJob(() => api.generate({
      prompt: composeLiteraryPrompt(input.prompt, knobs),
      lyrics: dir.structuredLyrics,
      duration_s: dir.duration_s,
      bpm: dir.bpm,
      key: dir.key,
      style_tags: dir.styleTags,
      output_format: 'wav',
      master: true,
      quality_preset: input.qualityPreset ?? 'turbo',
    }, token), dir.arNote)
  }, [knobs, releases.length, runJob, token])

  const repaint = useCallback(async (i: { prompt: string; start_s: number; end_s: number; qualityPreset?: QualityPreset }) => {
    if (!lastAudioPath) { setError('Necesitas un audio fuente desde La Terminal'); return }
    await runJob(() => api.repaint({
      prompt: i.prompt,
      source_audio_path: lastAudioPath,
      start_s: i.start_s,
      end_s: i.end_s,
      style_tags: knobsToStyleTags(knobs),
      output_format: 'wav',
      quality_preset: i.qualityPreset ?? 'turbo',
    }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const cover = useCallback(async (i: { prompt: string; qualityPreset?: QualityPreset }) => {
    if (!lastAudioPath) { setError('Necesitas un audio fuente desde La Terminal'); return }
    await runJob(() => api.cover({
      prompt: i.prompt,
      source_audio_path: lastAudioPath,
      style_tags: knobsToStyleTags(knobs),
      output_format: 'wav',
      quality_preset: i.qualityPreset ?? 'turbo',
    }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const splitStems = useCallback(async (i: { prompt: string }) => {
    await runJob(() => api.stems({ prompt: i.prompt, source_audio_path: lastAudioPath, style_tags: knobsToStyleTags(knobs), output_format: 'wav' }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const addRelease = useCallback((title: string, caption: string) => {
    if (!lastJobId) return
    setReleases((c) => [{ id: `${lastJobId}-${Date.now()}`, title, caption, jobId: lastJobId, audioUrl: jobAudioUrl(lastJobId), createdAt: new Date().toISOString() }, ...c])
  }, [lastJobId])

  const lastAudioUrl = lastJobId ? jobAudioUrl(lastJobId) : null
  const value = useMemo(
    () => ({
      view,
      setView,
      knobs,
      setKnob,
      pixelSignal,
      job,
      jobStatus,
      lastAudioPath,
      lastJobId,
      lastAudioUrl,
      busy,
      error,
      releases,
      capabilities,
      generations,
      generationsLoading,
      refreshGenerations,
      generate,
      repaint,
      cover,
      splitStems,
      addRelease,
    }),
    [addRelease, busy, capabilities, cover, error, generate, generations, generationsLoading, job, jobStatus, knobs, lastAudioPath, lastAudioUrl, lastJobId, pixelSignal, refreshGenerations, releases, repaint, setKnob, splitStems, view],
  )
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio debe usarse dentro de StudioProvider')
  return ctx
}
export function stemUrl(jobId: string, stem: 'drums' | 'bass' | 'other'): string { return `/api/v1/music/jobs/${jobId}/audio?stem=${stem}` }
