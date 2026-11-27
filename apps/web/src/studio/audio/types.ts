import type { PeakData } from '../lib/peaks'

export type StudioTrackId = 'master' | 'drums' | 'bass' | 'other'

export type StudioTrackSource = { id: StudioTrackId; label: string; url: string; color: string }

export type StudioTrack = {
  id: StudioTrackId
  label: string
  color: string
  buffer: AudioBuffer
  peaks: PeakData
  duration: number
}
