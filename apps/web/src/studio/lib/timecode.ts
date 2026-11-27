import { clampBpm } from './tempo'

export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const totalMs = Math.floor(safe * 1000)
  const minutes = Math.floor(totalMs / 60000)
  const secs = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function formatBarsBeats(seconds: number, bpm: number, numerator: number, denominator: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const tempo = clampBpm(bpm)
  const beatsPerBar = Math.max(1, Math.floor(numerator))
  const beatUnit = denominator === 8 ? 8 : 4
  const beatDuration = (60 / tempo) * (4 / beatUnit)
  const totalBeats = safe / beatDuration
  const barIndex = Math.floor(totalBeats / beatsPerBar)
  const beatIndex = Math.floor(totalBeats % beatsPerBar)
  const tick = Math.min(959, Math.floor((totalBeats % 1) * 960))
  return `${String(barIndex + 1).padStart(3, '0')}.${String(beatIndex + 1).padStart(2, '0')}.${String(tick).padStart(3, '0')}`
}
