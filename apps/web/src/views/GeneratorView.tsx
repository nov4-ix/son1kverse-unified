import { LiteraryKnob } from '@son1k/shared-ui'
import { useMemo, useState } from 'react'
import { useStudio } from '../context/StudioContext'
import { AuthedAudio } from '../components/AuthedAudio'
import { orchestrateAandR } from '../lib/pixelAandR'

export function GeneratorView() {
  const { knobs, setKnob, generate, busy, error, lastAudioUrl, jobStatus, releases } = useStudio()
  const [prompt, setPrompt] = useState('Nocturno industrial con voz quebrada y bajo de hormigón')
  const [lyrics, setLyrics] = useState('')
  const dir = useMemo(() => orchestrateAandR(prompt, lyrics, knobs, releases.length), [prompt, lyrics, knobs, releases.length])
  const min = Math.floor(dir.duration_s / 60)
  const sec = String(dir.duration_s % 60).padStart(2, '0')

  return (
    <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <p className="font-terminal text-[11px] uppercase tracking-[0.32em] text-alvae-gold">La Terminal</p>
          <span className="font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-terminal">A&R PIXEL // ORQUESTACIÓN AUTÓNOMA</span>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe la atmósfera, emoción o historia..." className="h-32 w-full border border-alvae-gold/30 bg-alvae-bg p-4 font-terminal text-sm text-alvae-ink outline-none focus:border-alvae-gold" maxLength={4000} />
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Letras opcionales (Pixel estructurará Intro, Versos, Coro y Puente)" className="h-28 w-full border border-alvae-gold/20 bg-transparent p-4 font-terminal text-sm text-alvae-ink outline-none focus:border-alvae-gold/60" maxLength={20000} />
        <div className="border border-alvae-gold/25 bg-alvae-bg/70 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-gold">
            <span>Arquitectura deducida por Pixel</span>
            <span className="text-alvae-terminal">{dir.bpm} BPM · {dir.key} · {min}:{sec}</span>
          </div>
          <p className="font-terminal text-[11px] text-alvae-muted">{dir.structure.join(' → ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" disabled={busy || prompt.trim() === ''} onClick={() => void generate({ prompt, lyrics })} className="border border-alvae-terminal bg-alvae-terminal/10 px-6 py-3 font-terminal text-xs uppercase tracking-[0.24em] text-alvae-terminal transition hover:bg-alvae-terminal/20 disabled:opacity-40">
            {busy ? `Sintetizando (${jobStatus})...` : 'Generar canción completa'}
          </button>
          {error && <span className="font-terminal text-xs text-red-400">{error}</span>}
        </div>
        {lastAudioUrl && (
          <div className="border border-alvae-gold/30 bg-alvae-bg/80 p-4 space-y-2">
            <p className="font-terminal text-[10px] uppercase tracking-[0.22em] text-alvae-gold">Master listo // {min}:{sec}</p>
            <AuthedAudio src={lastAudioUrl} className="w-full" />
          </div>
        )}
      </div>
      <div className="border border-alvae-gold/20 bg-alvae-bg/40 p-6">
        <p className="font-terminal text-[11px] uppercase tracking-[0.28em] text-alvae-muted mb-6">4 Perillas Literarias</p>
        <div className="grid grid-cols-2 gap-6">
          <LiteraryKnob label="Intensidad Creativa" hint="Tradicional → ruptura" value={knobs.creativeIntensity} onChange={(v) => setKnob('creativeIntensity', v)} />
          <LiteraryKnob label="Profundidad Emocional" hint="Superficie → herida" value={knobs.emotionalDepth} onChange={(v) => setKnob('emotionalDepth', v)} accent="#10B981" />
          <LiteraryKnob label="Nivel Experimental" hint="Canon → grieta" value={knobs.experimentalLevel} onChange={(v) => setKnob('experimentalLevel', v)} accent="#F59E0B" />
          <LiteraryKnob label="Estilo Narrativo" hint="Paisaje → fábula" value={knobs.narrativeStyle} onChange={(v) => setKnob('narrativeStyle', v)} />
        </div>
        <div className="mt-8 border-t border-alvae-gold/20 pt-5">
          <p className="font-terminal text-[11px] uppercase tracking-[0.22em] text-alvae-gold">Imperfección Humana / Quinto Acorde</p>
          <input type="range" min={0} max={1} step={0.01} value={knobs.humanImperfection} onChange={(e) => setKnob('humanImperfection', Number(e.target.value))} className="mt-4 w-full accent-alvae-gold" />
          <p className="mt-3 font-terminal text-xs text-alvae-muted">Lo imperfecto también es sagrado</p>
        </div>
      </div>
    </section>
  )
}
