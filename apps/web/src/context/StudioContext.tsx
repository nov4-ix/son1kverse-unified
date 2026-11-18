import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, isGenerationResult, jobAudioUrl, type JobStatus, type MusicJob } from '../lib/api'
import { useAuth } from './AuthContext'
import { orchestrateAandR } from '../lib/pixelAandR'
import { composeLiteraryPrompt, DEFAULT_KNOBS, knobsToStyleTags, signalForJob, signalForKnobs, type LiteraryKnobs } from '@son1k/shared-types'

export type ConsoleView = 'generator' | 'ghost' | 'nova'
export type ReleaseDraft = { id: string; title: string; caption: string; jobId: string; audioUrl: string; createdAt: string }

type StudioContextValue = {
  view: ConsoleView; setView: (v: ConsoleView) => void; knobs: LiteraryKnobs; setKnob: (k: keyof LiteraryKnobs, v: number) => void
  pixelSignal: string; job: MusicJob | null; jobStatus: JobStatus | 'idle'; lastAudioPath: string | null; lastJobId: string | null
  lastAudioUrl: string | null; busy: boolean; error: string | null; releases: ReleaseDraft[]
  generate: (input: { prompt: string; lyrics: string }) => Promise<void>
  repaint: (input: { prompt: string; start_s: number; end_s: number }) => Promise<void>
  cover: (input: { prompt: string }) => Promise<void>
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
  const { token, logout } = useAuth()

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
  }, [logout, token])

  const generate = useCallback(async (input: { prompt: string; lyrics: string }) => {
    const dir = orchestrateAandR(input.prompt, input.lyrics, knobs, releases.length)
    await runJob(() => api.generate({
      prompt: composeLiteraryPrompt(input.prompt, knobs),
      lyrics: dir.structuredLyrics,
      duration_s: dir.duration_s,
      bpm: dir.bpm,
      key: dir.key,
      style_tags: dir.styleTags,
      output_format: 'wav',
    }, token), dir.arNote)
  }, [knobs, releases.length, runJob, token])

  const repaint = useCallback(async (i: { prompt: string; start_s: number; end_s: number }) => {
    if (!lastAudioPath) { setError('Necesitas un audio fuente desde La Terminal'); return }
    await runJob(() => api.repaint({ prompt: i.prompt, source_audio_path: lastAudioPath, start_s: i.start_s, end_s: i.end_s, style_tags: knobsToStyleTags(knobs), output_format: 'wav' }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const cover = useCallback(async (i: { prompt: string }) => {
    if (!lastAudioPath) { setError('Necesitas un audio fuente desde La Terminal'); return }
    await runJob(() => api.cover({ prompt: i.prompt, source_audio_path: lastAudioPath, style_tags: knobsToStyleTags(knobs), output_format: 'wav' }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const splitStems = useCallback(async (i: { prompt: string }) => {
    await runJob(() => api.stems({ prompt: i.prompt, source_audio_path: lastAudioPath, style_tags: knobsToStyleTags(knobs), output_format: 'wav' }, token))
  }, [knobs, lastAudioPath, runJob, token])

  const addRelease = useCallback((title: string, caption: string) => {
    if (!lastJobId) return
    setReleases((c) => [{ id: `${lastJobId}-${Date.now()}`, title, caption, jobId: lastJobId, audioUrl: jobAudioUrl(lastJobId), createdAt: new Date().toISOString() }, ...c])
  }, [lastJobId])

  const lastAudioUrl = lastJobId ? jobAudioUrl(lastJobId) : null
  const value = useMemo(() => ({ view, setView, knobs, setKnob, pixelSignal, job, jobStatus, lastAudioPath, lastJobId, lastAudioUrl, busy, error, releases, generate, repaint, cover, splitStems, addRelease }), [addRelease, busy, cover, error, generate, job, jobStatus, knobs, lastAudioPath, lastAudioUrl, lastJobId, pixelSignal, releases, repaint, setKnob, splitStems, view])
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio debe usarse dentro de StudioProvider')
  return ctx
}
export function stemUrl(jobId: string, stem: 'drums' | 'bass' | 'other'): string { return `/api/v1/music/jobs/${jobId}/audio?stem=${stem}` }
