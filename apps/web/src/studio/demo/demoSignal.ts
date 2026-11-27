import { computePeaks } from '../lib/peaks'
import type { StudioTrack } from '../audio/types'

const SAMPLE_RATE = 44100
const DURATION = 8
const BPM = 120

// Señal sintética determinista: seno 110 Hz + armónico y clicks a 120 BPM 4/4.
// Solo se usa en DEV; no toca red, archivos ni estado global.
export function createDemoTrack(): StudioTrack {
  const length = SAMPLE_RATE * DURATION
  const buffer = new AudioBuffer({ numberOfChannels: 1, length, sampleRate: SAMPLE_RATE })
  const data = buffer.getChannelData(0)
  const beat = 60 / BPM

  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE
    let value = Math.sin(2 * Math.PI * 110 * t) * 0.18 + Math.sin(2 * Math.PI * 220 * t) * 0.08
    const phase = t % beat
    if (phase < 0.02) value += Math.exp(-phase * 120) * 0.5
    data[i] = value
  }

  return {
    id: 'master',
    label: 'DEMO',
    color: 'var(--studio-track-master)',
    buffer,
    peaks: computePeaks(data, 2048),
    duration: DURATION,
  }
}
