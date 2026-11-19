import { useEffect, useRef, useState } from 'react'
import { isStemsResult } from '../lib/api'
import { stemUrl, useStudio } from '../context/StudioContext'
import { AuthedAudio } from '../components/AuthedAudio'
import { useAuthorizedAudio } from '../lib/useAuthorizedAudio'

function drawWaveform(
  canvas: HTMLCanvasElement,
  data: Float32Array,
  startRatio: number,
  endRatio: number,
): void {
  const context = canvas.getContext('2d')
  if (context === null) return
  const { width, height } = canvas
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#0A0B0E'
  context.fillRect(0, 0, width, height)

  const scarX = Math.floor(startRatio * width)
  const scarW = Math.max(2, Math.floor((endRatio - startRatio) * width))
  context.fillStyle = 'rgba(212, 163, 89, 0.22)'
  context.fillRect(scarX, 0, scarW, height)

  context.strokeStyle = '#10B981'
  context.lineWidth = 1
  context.beginPath()
  const step = Math.max(1, Math.floor(data.length / width))
  for (let x = 0; x < width; x += 1) {
    const index = Math.min(data.length - 1, x * step)
    const sample = data[index] ?? 0
    const y = height / 2 - sample * (height * 0.42)
    if (x === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()

  context.strokeStyle = '#D4A359'
  context.beginPath()
  context.moveTo(scarX, 0)
  context.lineTo(scarX, height)
  context.moveTo(scarX + scarW, 0)
  context.lineTo(scarX + scarW, height)
  context.stroke()
}

export function GhostStudioView() {
  const {
    lastAudioUrl,
    lastJobId,
    lastAudioPath,
    job,
    busy,
    error,
    repaint,
    cover,
    splitStems,
  } = useStudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { buffer } = useAuthorizedAudio(lastAudioUrl)
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0))
  const [duration, setDuration] = useState(30)
  const [startS, setStartS] = useState(0)
  const [endS, setEndS] = useState(8)
  const [prompt, setPrompt] = useState('Repintar la herida. Dejar el polvo.')

  useEffect(() => {
    if (buffer === null) return
    const audioContext = new AudioContext()
    let cancelled = false
    void audioContext.decodeAudioData(buffer.slice(0))
      .then((decoded) => {
        if (cancelled) return
        const channel = decoded.getChannelData(0)
        const bins = 720
        const block = Math.max(1, Math.floor(channel.length / bins))
        const reduced = new Float32Array(bins)
        for (let i = 0; i < bins; i += 1) {
          let peak = 0
          const offset = i * block
          for (let j = 0; j < block; j += 1) {
            const sample = Math.abs(channel[offset + j] ?? 0)
            if (sample > peak) peak = sample
          }
          reduced[i] = peak
        }
        setPeaks(reduced)
        setDuration(decoded.duration)
        setEndS((current) => Math.min(current, decoded.duration))
      })
      .catch(() => {
        /* el canvas permanece vacío si el WAV aún no está listo */
      })
    return () => {
      cancelled = true
      void audioContext.close()
    }
  }, [buffer])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || peaks.length === 0) return
    const safeDuration = duration <= 0 ? 1 : duration
    drawWaveform(canvas, peaks, startS / safeDuration, endS / safeDuration)
  }, [duration, endS, peaks, startS])

  const jobResult = job?.result ?? null
  const stems = isStemsResult(jobResult) ? jobResult.stems : undefined

  return (
    <section className="space-y-6">
      <p className="font-terminal text-[11px] uppercase tracking-[0.32em] text-alvae-gold">Ghost Studio</p>
      <div className="border border-alvae-gold/20 bg-alvae-panel p-4">
        <canvas ref={canvasRef} width={720} height={160} className="h-40 w-full" />
        {lastAudioUrl !== null && (
          <AuthedAudio className="mt-4 w-full" src={lastAudioUrl} />
        )}
        <p className="mt-3 font-terminal text-[10px] text-alvae-muted">
          Fuente: {lastAudioPath ?? 'sin audio. Genera primero en La Terminal.'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <form
          className="space-y-3 border border-alvae-gold/20 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void repaint({ prompt, start_s: startS, end_s: endS })
          }}
        >
          <p className="font-terminal text-xs uppercase tracking-[0.2em] text-alvae-gold">Repaint</p>
          <label className="block font-terminal text-[10px] text-alvae-muted">
            start_s
            <input
              type="number"
              min={0}
              step={0.1}
              value={startS}
              onChange={(event) => setStartS(Number(event.target.value))}
              className="mt-1 w-full border border-alvae-gold/20 bg-alvae-bg px-2 py-2 text-alvae-ink"
            />
          </label>
          <label className="block font-terminal text-[10px] text-alvae-muted">
            end_s
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={endS}
              onChange={(event) => setEndS(Number(event.target.value))}
              className="mt-1 w-full border border-alvae-gold/20 bg-alvae-bg px-2 py-2 text-alvae-ink"
            />
          </label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="h-20 w-full border border-alvae-gold/20 bg-alvae-bg p-2 font-terminal text-sm text-alvae-ink"
          />
          <button type="submit" disabled={busy} className="border border-alvae-gold px-3 py-2 font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-gold">
            Repintar tramo
          </button>
        </form>

        <form
          className="space-y-3 border border-alvae-gold/20 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void cover({ prompt })
          }}
        >
          <p className="font-terminal text-xs uppercase tracking-[0.2em] text-alvae-gold">Cover</p>
          <p className="font-terminal text-[10px] text-alvae-muted">
            Reinterpreta la fuente con el prompt actual.
          </p>
          <button type="submit" disabled={busy} className="border border-alvae-terminal px-3 py-2 font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-terminal">
            Cubrir
          </button>
        </form>

        <form
          className="space-y-3 border border-alvae-gold/20 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void splitStems({ prompt })
          }}
        >
          <p className="font-terminal text-xs uppercase tracking-[0.2em] text-alvae-gold">Stems</p>
          <p className="font-terminal text-[10px] text-alvae-muted">drums / bass / other</p>
          <button type="submit" disabled={busy} className="border border-alvae-gold px-3 py-2 font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-gold">
            Separar
          </button>
          {lastJobId !== null && stems !== undefined && (
            <div className="space-y-2">
              {(['drums', 'bass', 'other'] as const).map((stem) => (
                <AuthedAudio key={stem} className="w-full" src={stemUrl(lastJobId, stem)} />
              ))}
            </div>
          )}
        </form>
      </div>
      {error !== null && <p className="font-terminal text-xs text-red-400">{error}</p>}
    </section>
  )
}
