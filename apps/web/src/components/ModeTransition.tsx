import { useSystemMode } from '../context/SystemModeContext'

export function ModeTransition() {
  const { transitioning, displayedProtocol } = useSystemMode()
  if (!transitioning) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-50 animate-flicker bg-black scanlines">
      <div className="flex h-full items-center justify-end px-10">
        <p className="font-terminal text-sm tracking-[0.35em] text-alvae-terminal">
          SYS_PROTOCOL: {displayedProtocol}
        </p>
      </div>
    </div>
  )
}
