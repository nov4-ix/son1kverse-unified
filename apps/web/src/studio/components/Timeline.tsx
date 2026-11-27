import { useEffect, useRef } from 'react'
import { formatBarsBeats } from '../lib/timecode'
import type { StudioTrack } from '../audio/types'
import type { StudioTransport } from '../audio/useTransport'
import { TrackHeader } from './TrackHeader'
import { WaveformCanvas } from './WaveformCanvas'

export function Timeline({ tracks, transport }: { tracks: StudioTrack[]; transport: StudioTransport }) {
  const rangeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return transport.subscribeFrame((seconds) => {
      const input = rangeRef.current
      if (!input || document.activeElement === input) return
      input.value = String(seconds)
    })
  }, [transport])

  if (tracks.length === 0) return null

  const duration = transport.duration
  const beatDuration = (60 / transport.bpm) * (4 / transport.denominator)
  const barSeconds = beatDuration * transport.numerator
  const totalBars = duration > 0 ? Math.ceil(duration / barSeconds) : 0
  const step = Math.max(1, Math.ceil(totalBars / 64))
  const ticks: { bar: number; left: number }[] = []
  for (let bar = 0; bar < totalBars && ticks.length < 200; bar += step) {
    ticks.push({ bar, left: ((bar * barSeconds) / duration) * 100 })
  }

  return (
    <div className="border border-studio-line bg-studio-surface">
      <div
        className="grid border-b border-studio-line"
        style={{ gridTemplateColumns: 'var(--track-header-width) 1fr' }}
      >
        <div
          className="flex items-center border-r border-studio-line px-3 font-readout text-[9px] uppercase tracking-[0.2em] text-studio-muted"
          style={{ height: 'var(--ruler-height)' }}
        >
          TIMELINE
        </div>
        <div className="relative min-w-0" style={{ height: 'var(--ruler-height)' }}>
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            {ticks.map((tick) => (
              <div key={tick.bar} className="absolute top-0 h-full" style={{ left: `${tick.left}%` }}>
                <div className="h-1.5 w-px bg-studio-line-strong" />
                <span className="studio-readout absolute left-1 top-1.5 text-[9px] text-studio-muted">
                  {formatBarsBeats(
                    tick.bar * barSeconds,
                    transport.bpm,
                    transport.numerator,
                    transport.denominator,
                  ).slice(0, 3)}
                </span>
              </div>
            ))}
          </div>
          <input
            ref={rangeRef}
            type="range"
            min={0}
            max={duration > 0 ? duration : 1}
            step={0.001}
            defaultValue={0}
            disabled={duration === 0}
            aria-label="Posición del playhead"
            onChange={(event) => transport.seek(Number(event.target.value))}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-studio-accent focus-visible:outline-offset-0"
          />
        </div>
      </div>

      {tracks.map((track) => (
        <div
          key={track.id}
          className="grid border-b border-studio-line last:border-b-0"
          style={{ gridTemplateColumns: 'var(--track-header-width) 1fr' }}
        >
          <TrackHeader track={track} />
          <WaveformCanvas
            peaks={track.peaks}
            color={track.color}
            duration={track.duration}
            transport={transport}
            label={track.label}
          />
        </div>
      ))}
    </div>
  )
}
