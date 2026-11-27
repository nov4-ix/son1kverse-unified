import { useEffect, useRef, useState } from 'react'
import { AlvaeSymbol } from '@son1k/shared-ui'
import { clampBpm } from '../lib/tempo'
import { formatBarsBeats, formatTimecode } from '../lib/timecode'
import type { StudioTransport } from '../audio/useTransport'

const FOCUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-studio-accent focus-visible:outline-offset-2'

export function TransportBar({ transport }: { transport: StudioTransport }) {
  const timeRef = useRef<HTMLSpanElement>(null)
  const barsRef = useRef<HTMLSpanElement>(null)
  const [bpmDraft, setBpmDraft] = useState(String(transport.bpm))

  useEffect(() => {
    setBpmDraft(String(transport.bpm))
  }, [transport.bpm])

  useEffect(() => {
    return transport.subscribeFrame((seconds) => {
      if (timeRef.current) timeRef.current.textContent = formatTimecode(seconds)
      if (barsRef.current) {
        barsRef.current.textContent = formatBarsBeats(
          seconds,
          transport.bpm,
          transport.numerator,
          transport.denominator,
        )
      }
    })
  }, [transport, transport.bpm, transport.denominator, transport.numerator])

  const commitBpm = () => {
    const next = clampBpm(Number(bpmDraft))
    transport.setBpm(next)
    setBpmDraft(String(next))
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-studio-line bg-studio-panel px-3"
      style={{ minHeight: 'var(--transport-height)' }}
    >
      <div className="flex items-center gap-2">
        <AlvaeSymbol className="h-5 w-5 text-studio-accent" />
        <div className="leading-tight">
          <p className="font-readout text-[10px] uppercase tracking-[0.28em] text-studio-text">GHOST STUDIO</p>
          <p className="font-readout text-[9px] uppercase tracking-[0.32em] text-studio-muted">NOV4-IX</p>
        </div>
      </div>

      <button
        type="button"
        aria-label={transport.isPlaying ? 'Detener' : 'Reproducir'}
        disabled={transport.duration === 0}
        onClick={() => {
          if (transport.isPlaying) transport.stop()
          else void transport.play()
        }}
        className={`flex items-center justify-center border border-studio-line-strong bg-studio-raised text-studio-accent disabled:opacity-40 ${FOCUS}`}
        style={{ width: 'var(--control-height)', height: 'var(--control-height)' }}
      >
        {transport.isPlaying ? (
          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 fill-current">
            <rect x="1.5" y="1.5" width="9" height="9" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 fill-current">
            <polygon points="2,1 11,6 2,11" />
          </svg>
        )}
      </button>

      <div className="flex items-center gap-1.5">
        <label htmlFor="studio-bpm" className="font-readout text-[10px] uppercase tracking-[0.2em] text-studio-muted">
          BPM
        </label>
        <input
          id="studio-bpm"
          type="number"
          min={30}
          max={300}
          step={1}
          value={bpmDraft}
          onChange={(event) => {
            const raw = event.target.value
            setBpmDraft(raw)
            const next = Number(raw)
            if (Number.isFinite(next) && next >= 30 && next <= 300) transport.setBpm(next)
          }}
          onBlur={commitBpm}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitBpm()
            }
          }}
          className={`studio-readout border border-studio-line bg-studio-bg px-1 text-right text-studio-text ${FOCUS}`}
          style={{ width: 'calc(var(--readout-bpm-width) + 1.5ch)', height: 'var(--control-height)' }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="font-readout text-[10px] uppercase tracking-[0.2em] text-studio-muted">COMPÁS</span>
        <select
          aria-label="Numerador del compás"
          value={transport.numerator}
          onChange={(event) => transport.setTimeSignature(Number(event.target.value), transport.denominator)}
          className={`studio-readout border border-studio-line bg-studio-bg px-1 text-studio-text ${FOCUS}`}
          style={{ width: '5ch', height: 'var(--control-height)' }}
        >
          {[2, 3, 4, 5, 6, 7].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="font-readout text-[11px] text-studio-muted">
          /
        </span>
        <select
          aria-label="Denominador del compás"
          value={transport.denominator}
          onChange={(event) => transport.setTimeSignature(transport.numerator, Number(event.target.value))}
          className={`studio-readout border border-studio-line bg-studio-bg px-1 text-studio-text ${FOCUS}`}
          style={{ width: '5ch', height: 'var(--control-height)' }}
        >
          {[4, 8].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span
          className="font-readout text-[9px] uppercase tracking-[0.18em] text-studio-muted"
          title="BPM y compás definen la regla y el readout; no implican que el audio se generó exactamente a ese tempo."
        >
          GRILLA NOMINAL
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span
          ref={timeRef}
          aria-hidden="true"
          className="studio-readout text-[13px] text-studio-text"
          style={{ width: 'var(--readout-time-width)' }}
        >
          {formatTimecode(0)}
        </span>
        <span
          ref={barsRef}
          aria-hidden="true"
          className="studio-readout text-[13px] text-studio-accent"
          style={{ width: 'var(--readout-time-width)' }}
          title="Compás.beat.tick"
        >
          {formatBarsBeats(0, transport.bpm, transport.numerator, transport.denominator)}
        </span>
      </div>
    </div>
  )
}
