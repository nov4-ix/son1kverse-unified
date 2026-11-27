import { memo, useCallback, useEffect, useRef } from 'react'
import type { PeakData } from '../lib/peaks'
import type { StudioTransport } from '../audio/useTransport'
import { studioDebug } from '../debug/studioDebug'

type WaveformCanvasProps = {
  peaks: PeakData
  color: string
  duration: number
  transport: StudioTransport
  label: string
}

function resolveColor(color: string): string {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(color.trim())
  if (!match) return color
  const name = match[1] ?? ''
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || '#E7E5E4'
}

function WaveformCanvasImpl({ peaks, color, duration, transport, label }: WaveformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cacheRef = useRef<HTMLCanvasElement | null>(null)
  const playheadColorRef = useRef('#D4A359')
  const sizeRef = useRef({ cssWidth: 0, cssHeight: 0, dpr: 1 })
  const positionRef = transport.positionRef

  useEffect(() => studioDebug.registerCanvas(), [])

  const drawFrame = useCallback(
    (seconds: number) => {
      const canvas = canvasRef.current
      const cache = cacheRef.current
      if (!canvas || !cache) return
      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(cache, 0, 0)
      if (duration <= 0) return
      const ratio = Math.min(1, Math.max(0, seconds / duration))
      const x = Math.min(Math.max(0, canvas.width - 1), Math.round(ratio * canvas.width))
      context.fillStyle = playheadColorRef.current
      context.fillRect(x, 0, 1, canvas.height)
    },
    [duration],
  )

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const rebuildCache = (width: number, height: number, dpr: number) => {
      const cache = cacheRef.current ?? document.createElement('canvas')
      cacheRef.current = cache
      cache.width = Math.max(1, Math.floor(width * dpr))
      cache.height = Math.max(1, Math.floor(height * dpr))
      const context = cache.getContext('2d')
      if (!context) return

      context.clearRect(0, 0, cache.width, cache.height)
      const mid = cache.height / 2
      const half = cache.height * 0.42
      context.fillStyle = 'rgba(231, 229, 228, 0.12)'
      context.fillRect(0, Math.floor(mid), cache.width, 1)

      const bins = peaks.bins
      if (bins < 1) return
      context.fillStyle = resolveColor(color)
      context.globalAlpha = 0.9
      const strokeWidth = Math.max(1, Math.ceil(dpr))
      for (let x = 0; x < width; x += 1) {
        const from = Math.min(bins - 1, Math.floor((x * bins) / width))
        const to = Math.min(bins - 1, Math.ceil(((x + 1) * bins) / width) - 1)
        let min = peaks.min[from] ?? 0
        let max = peaks.max[from] ?? 0
        for (let bin = from + 1; bin <= to; bin += 1) {
          const binMin = peaks.min[bin] ?? 0
          const binMax = peaks.max[bin] ?? 0
          if (binMin < min) min = binMin
          if (binMax > max) max = binMax
        }
        const top = mid - max * half
        const bottom = mid - min * half
        context.fillRect(x * dpr, top, strokeWidth, Math.max(1, bottom - top))
      }
      context.globalAlpha = 1
      playheadColorRef.current = resolveColor('var(--studio-playhead)')
    }

    const applySize = () => {
      const cssWidth = Math.max(1, Math.floor(container.clientWidth))
      const cssHeight = Math.max(1, Math.floor(container.clientHeight))
      const dpr = window.devicePixelRatio || 1
      const size = sizeRef.current
      if (size.cssWidth === cssWidth && size.cssHeight === cssHeight && size.dpr === dpr) return false
      sizeRef.current = { cssWidth, cssHeight, dpr }
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
      return true
    }

    const sync = () => {
      applySize()
      const { cssWidth, cssHeight, dpr } = sizeRef.current
      rebuildCache(cssWidth, cssHeight, dpr)
      drawFrame(positionRef.current)
    }

    const observer = new ResizeObserver(() => {
      if (applySize()) {
        const { cssWidth, cssHeight, dpr } = sizeRef.current
        rebuildCache(cssWidth, cssHeight, dpr)
      }
      drawFrame(positionRef.current)
    })
    observer.observe(container)
    sync()

    return () => observer.disconnect()
  }, [color, drawFrame, peaks, positionRef])

  useEffect(() => transport.subscribeFrame((seconds) => drawFrame(seconds)), [drawFrame, transport])

  return (
    <div ref={containerRef} className="relative min-w-0" style={{ height: 'var(--track-height)' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Waveform ${label}`}
        className="block h-full w-full"
      />
    </div>
  )
}

export const WaveformCanvas = memo(WaveformCanvasImpl)
