import { useEffect, useMemo, useState } from 'react'
import { AlvaeSymbol, PlatformLogo } from '@son1k/shared-ui'
import { stemUrl, useStudio } from '../../context/StudioContext'
import { AudioEngine } from '../audio/audioEngine'
import { useStudioTracks } from '../audio/useStudioTracks'
import { useTransport } from '../audio/useTransport'
import type { StudioTrack, StudioTrackSource } from '../audio/types'
import { TransportBar } from './TransportBar'
import { Timeline } from './Timeline'

const CTA =
  'border border-studio-line-strong bg-studio-raised px-3 py-1.5 font-readout text-[10px] uppercase tracking-[0.2em] text-studio-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-studio-accent focus-visible:outline-offset-2'

export function StudioShell() {
  const {
    masterAudioUrl,
    masterBpm,
    masterJobId,
    stems,
    stemsJobId,
    setView,
    error: studioError,
  } = useStudio()
  const engine = useMemo(() => new AudioEngine(), [])

  useEffect(() => () => engine.dispose(), [engine])

  const sources = useMemo<StudioTrackSource[]>(() => {
    const list: StudioTrackSource[] = []
    if (masterAudioUrl !== null) {
      list.push({ id: 'master', label: 'MASTER', url: masterAudioUrl, color: 'var(--studio-track-master)' })
    }
    if (stemsJobId !== null && stems !== null) {
      if (stems.drums) {
        list.push({ id: 'drums', label: 'DRUMS', url: stemUrl(stemsJobId, 'drums'), color: 'var(--studio-track-drums)' })
      }
      if (stems.bass) {
        list.push({ id: 'bass', label: 'BASS', url: stemUrl(stemsJobId, 'bass'), color: 'var(--studio-track-bass)' })
      }
      if (stems.other) {
        list.push({ id: 'other', label: 'OTHER', url: stemUrl(stemsJobId, 'other'), color: 'var(--studio-track-other)' })
      }
    }
    return list
  }, [masterAudioUrl, stems, stemsJobId])

  const { tracks, masterBuffer, loading, error, warnings } = useStudioTracks(engine, sources)
  const [demoTrack, setDemoTrack] = useState<StudioTrack | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)

  useEffect(() => {
    if (masterAudioUrl !== null) setDemoTrack(null)
  }, [masterAudioUrl])

  const activeTracks = demoTrack !== null ? [demoTrack] : tracks
  const activeBuffer = demoTrack !== null ? demoTrack.buffer : masterBuffer
  const transport = useTransport(engine, activeBuffer, masterBpm ?? undefined)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || target.isContentEditable) {
          return
        }
      }
      if (event.code === 'Space') {
        event.preventDefault()
        if (transport.isPlaying) transport.stop()
        else void transport.play()
      } else if (event.key === 'Home') {
        event.preventDefault()
        transport.seek(0)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        transport.seek(Math.max(0, transport.positionRef.current - 1))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        transport.seek(transport.positionRef.current + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [transport])

  const loadDemo = async () => {
    setDemoLoading(true)
    try {
      const module = await import('../demo/demoSignal')
      setDemoTrack(module.createDemoTrack())
    } finally {
      setDemoLoading(false)
    }
  }

  const sourceLabel =
    demoTrack !== null ? 'DEMO' : masterAudioUrl !== null ? 'MASTER' : 'SIN AUDIO'
  const shownError = error ?? studioError

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlvaeSymbol className="h-7 w-7 text-studio-accent" />
          <div className="leading-tight">
            <p className="font-readout text-[11px] uppercase tracking-[0.3em] text-studio-text">ESTUDIO DAW</p>
            <p className="font-readout text-[9px] uppercase tracking-[0.32em] text-studio-muted">ALVAE · NOV4-IX</p>
          </div>
        </div>
      </header>

      <TransportBar transport={transport} />

      {demoTrack !== null && (
        <p className="border border-studio-line bg-studio-raised px-3 py-1.5 font-readout text-[10px] uppercase tracking-[0.2em] text-studio-accent">
          DEMO · señal de prueba activa
        </p>
      )}

      {activeTracks.length > 0 ? (
        <Timeline tracks={activeTracks} transport={transport} />
      ) : (
        <div className="border border-studio-line bg-studio-surface p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <PlatformLogo className="h-14 w-14 opacity-80" />
            <p className="font-readout text-[11px] uppercase tracking-[0.28em] text-studio-muted">
              {loading ? 'Decodificando audio…' : 'Sin audio en el estudio'}
            </p>
            <p className="font-readout text-[10px] text-studio-muted">
              Genera en La Terminal o carga la señal DEMO de desarrollo.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" className={CTA} onClick={() => setView('generator')}>
                Ir a La Terminal
              </button>
              {import.meta.env.DEV && (
                <button type="button" className={CTA} disabled={demoLoading} onClick={() => void loadDemo()}>
                  {demoLoading ? 'Cargando…' : 'Cargar DEMO'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-readout text-[9px] uppercase tracking-[0.18em] text-studio-muted">
        <span>Grilla nominal</span>
        <span>Fuente: {sourceLabel}</span>
        {masterJobId !== null && <span>Master: {masterJobId.slice(0, 8)}</span>}
        {stemsJobId !== null && <span>Stems: {stemsJobId.slice(0, 8)}</span>}
      </div>

      {shownError !== null && <p className="font-readout text-[10px] text-studio-danger">{shownError}</p>}
      {warnings.map((warning) => (
        <p key={warning} className="font-readout text-[10px] text-studio-muted">
          {warning}
        </p>
      ))}
    </section>
  )
}
