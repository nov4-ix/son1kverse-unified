import { formatTimecode } from '../lib/timecode'
import type { StudioTrack } from '../audio/types'

export function TrackHeader({ track }: { track: StudioTrack }) {
  return (
    <div
      className="flex min-w-0 flex-col justify-center gap-1 border-r border-studio-line px-3"
      style={{ height: 'var(--track-height)' }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: track.color }} />
        <span className="truncate font-readout text-[11px] uppercase tracking-[0.16em] text-studio-text">
          {track.label}
        </span>
        <span className="font-readout text-[9px] uppercase tracking-[0.18em] text-studio-muted">
          {track.id === 'master' ? 'MASTER' : 'STEM'}
        </span>
      </div>
      <span className="studio-readout text-[10px] text-studio-muted">{formatTimecode(track.duration)}</span>
    </div>
  )
}
