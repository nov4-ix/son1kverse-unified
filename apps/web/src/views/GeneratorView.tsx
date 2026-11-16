import { LiteraryKnob } from '@son1k/shared-ui'
import { useState } from 'react'
import { useStudio } from '../context/StudioContext'

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export function GeneratorView() {
  const { knobs, setKnob, generate, busy, error, lastAudioUrl, jobStatus } = useStudio()
  const [prompt, setPrompt] = useState('Nocturno industrial con voz quebrada y bajo de hormigón')
  const [lyrics, setLyrics] = useState('')
  const [duration, setDuration] = useState(30)
  const [bpm, setBpm] = useState(120)
  const [key, setKey] = useState('C')

  return (
    <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <p className="font-terminal text-[11px] uppercase tracking-[0.32em] text-alvae-gold">La Terminal</p>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="h-32 w-full border border-alvae-gold/30 bg-alvae-bg p-4 font-terminal text-sm text-alvae-ink outline-none"
          maxLength={4000}
        />
        <textarea
          value={lyrics}
          onChange={(event) => setLyrics(event.target.value)}
          placeholder="Letras opcionales"
          className="h-24 w-full border border-alvae-gold/20 bg-transparent p-4 font-terminal text-sm text-alvae-ink outline-none"
          maxLength={20000}
        />
        <div className="grid grid-cols-3 gap-3">
          <label className="font-terminal text-[10px] uppercase tracking-[0.18em] text-alvae-muted">
            Duración
            <input
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="mt-2 w-full border border-alvae-gold/20 bg-alvae-bg px-2 py-2 text-alvae-ink"
            />
          </label>
          <label className="font-terminal text-[10px] uppercase tracking-[0.18em] text-alvae-muted">
            BPM
            <input
              type="number"
              min={30}
              max={300}
              value={bpm}
              onChange={(event) => setBpm(Number(event.target.value))}
              className="mt-2 w-full border border-alvae-gold/20 bg-alvae-bg px-2 py-2 text-alvae-ink"
            />
          </label>
          <label className="font-terminal text-[10px] uppercase tracking-[0.18em] text-alvae-muted">
            Tonalidad
            <select
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="mt-2 w-full border border-alvae-gold/20 bg-alvae-bg px-2 py-2 text-alvae-ink"
            >
              {KEYS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={busy || prompt.trim() === ''}
          onClick={() => void generate({ prompt, lyrics, duration_s: duration, bpm, key })}
          className="border border-alvae-terminal px-5 py-3 font-terminal text-xs uppercase tracking-[0.28em] text-alvae-terminal disabled:opacity-40"
        >
          {busy ? jobStatus : 'Generar'}
        </button>
        {error !== null && <p className="font-terminal text-xs text-red-400">{error}</p>}
        {lastAudioUrl !== null && (
          <audio className="w-full" controls src={lastAudioUrl} />
        )}
      </div>

      <div className="border border-alvae-gold/20 bg-alvae-panel p-6">
        <p className="mb-6 font-terminal text-[11px] uppercase tracking-[0.28em] text-alvae-gold">
          4 Perillas Literarias
        </p>
        <div className="grid grid-cols-2 gap-6">
          <LiteraryKnob
            label="Intensidad Creativa"
            hint="Tradicional → ruptura"
            value={knobs.creativeIntensity}
            onChange={(value) => setKnob('creativeIntensity', value)}
          />
          <LiteraryKnob
            label="Profundidad Emocional"
            hint="Superficie → herida"
            value={knobs.emotionalDepth}
            onChange={(value) => setKnob('emotionalDepth', value)}
            accent="#10B981"
          />
          <LiteraryKnob
            label="Nivel Experimental"
            hint="Canon → grieta"
            value={knobs.experimentalLevel}
            onChange={(value) => setKnob('experimentalLevel', value)}
            accent="#F59E0B"
          />
          <LiteraryKnob
            label="Estilo Narrativo"
            hint="Paisaje → fábula"
            value={knobs.narrativeStyle}
            onChange={(value) => setKnob('narrativeStyle', value)}
          />
        </div>
        <div className="mt-8 border-t border-alvae-gold/20 pt-5">
          <p className="font-terminal text-[11px] uppercase tracking-[0.22em] text-alvae-gold">
            Imperfección Humana / Quinto Acorde
          </p>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={knobs.humanImperfection}
            onChange={(event) => setKnob('humanImperfection', Number(event.target.value))}
            className="mt-4 w-full accent-alvae-gold"
          />
          <p className="mt-3 font-terminal text-xs text-alvae-muted">
            Lo imperfecto también es sagrado
          </p>
        </div>
      </div>
    </section>
  )
}
