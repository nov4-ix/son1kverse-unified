import { PlatformLogo } from '@son1k/shared-ui'
import { useSystemMode } from '../context/SystemModeContext'
import { useStudio } from '../context/StudioContext'

export function PixelNerve() {
  const { mode, beginHold, endHold } = useSystemMode()
  const { pixelSignal, jobStatus } = useStudio()

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex flex-col items-center ${
        mode === 'alvae' ? 'w-2 md:w-14' : 'w-2'
      }`}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
    >
      <button
        type="button"
        aria-label="Pixel"
        className={`mt-6 h-1.5 w-1.5 rounded-full md:hidden ${
          mode === 'alvae' ? 'bg-alvae-terminal animate-pulse-pixel' : 'bg-amber-500 animate-pulse-pixel'
        }`}
      />
      <div
        className={`mt-8 hidden h-2 w-2 rounded-full md:block ${
          mode === 'alvae' ? 'bg-alvae-terminal animate-pulse-pixel' : 'bg-amber-500 animate-pulse-pixel'
        }`}
      />
      {mode === 'alvae' && (
        <div className="mt-8 hidden w-full flex-1 flex-col items-center gap-4 px-1 md:flex">
          <PlatformLogo className="h-6 w-6 text-alvae-gold" />
          <div className="h-full w-px bg-alvae-gold/40" />
          <p
            className="origin-center rotate-180 font-terminal text-[10px] leading-4 tracking-[0.18em] text-alvae-terminal"
            style={{ writingMode: 'vertical-rl' }}
          >
            {pixelSignal}
          </p>
          <span className="mb-6 font-terminal text-[9px] uppercase tracking-[0.2em] text-alvae-muted">
            {jobStatus}
          </span>
        </div>
      )}
    </aside>
  )
}
