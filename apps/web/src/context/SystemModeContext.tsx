import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type SystemMode = 'xentrix' | 'alvae'
export type ProtocolLabel = 'ctrl+alt=Security' | 'ctrl+ALT=humanity'

const STORAGE_KEY = 'son1k.systemMode'
const TRANSITION_MS = 1200
const HOLD_MS = 1500

type SystemModeContextValue = {
  mode: SystemMode
  protocol: ProtocolLabel
  displayedProtocol: string
  transitioning: boolean
  toggleMode: () => void
  beginHold: () => void
  endHold: () => void
}

const SystemModeContext = createContext<SystemModeContextValue | null>(null)

function protocolFor(mode: SystemMode): ProtocolLabel {
  return mode === 'alvae' ? 'ctrl+ALT=humanity' : 'ctrl+alt=Security'
}

function readStoredMode(): SystemMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'alvae' ? 'alvae' : 'xentrix'
  } catch {
    return 'xentrix'
  }
}

function rewriteProtocol(from: string, to: string, progress: number): string {
  const width = Math.max(from.length, to.length)
  const paddedFrom = from.padEnd(width, ' ')
  const paddedTo = to.padEnd(width, ' ')
  const replaced = Math.round(progress * width)
  const chars: string[] = []
  for (let index = 0; index < width; index += 1) {
    const fromRight = width - 1 - index
    chars[fromRight] = index < replaced
      ? (paddedTo[fromRight] ?? ' ')
      : (paddedFrom[fromRight] ?? ' ')
  }
  return chars.join('').trimEnd()
}

export function SystemModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SystemMode>('xentrix')
  const [displayedProtocol, setDisplayedProtocol] = useState<string>(protocolFor('xentrix'))
  const [transitioning, setTransitioning] = useState(false)
  const lockRef = useRef(false)
  const holdRef = useRef<number | null>(null)

  useEffect(() => {
    const stored = readStoredMode()
    setMode(stored)
    setDisplayedProtocol(protocolFor(stored))
  }, [])

  const toggleMode = useCallback(() => {
    if (lockRef.current) return
    lockRef.current = true
    setTransitioning(true)

    const fromMode = mode
    const toMode: SystemMode = fromMode === 'xentrix' ? 'alvae' : 'xentrix'
    const fromProtocol = protocolFor(fromMode)
    const toProtocol = protocolFor(toMode)
    const started = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / TRANSITION_MS)
      setDisplayedProtocol(rewriteProtocol(fromProtocol, toProtocol, progress))
      if (progress < 1) {
        window.requestAnimationFrame(tick)
        return
      }
      setMode(toMode)
      setDisplayedProtocol(toProtocol)
      setTransitioning(false)
      lockRef.current = false
      try {
        window.localStorage.setItem(STORAGE_KEY, toMode)
      } catch {
        /* persistencia opcional */
      }
    }

    window.requestAnimationFrame(tick)
  }, [mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        toggleMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMode])

  const beginHold = useCallback(() => {
    if (holdRef.current !== null) return
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null
      toggleMode()
    }, HOLD_MS)
  }, [toggleMode])

  const endHold = useCallback(() => {
    if (holdRef.current === null) return
    window.clearTimeout(holdRef.current)
    holdRef.current = null
  }, [])

  const value = useMemo<SystemModeContextValue>(() => ({
    mode,
    protocol: protocolFor(mode),
    displayedProtocol,
    transitioning,
    toggleMode,
    beginHold,
    endHold,
  }), [beginHold, displayedProtocol, endHold, mode, toggleMode, transitioning])

  return (
    <SystemModeContext.Provider value={value}>
      {children}
    </SystemModeContext.Provider>
  )
}

export function useSystemMode(): SystemModeContextValue {
  const context = useContext(SystemModeContext)
  if (context === null) {
    throw new Error('useSystemMode must be used within SystemModeProvider')
  }
  return context
}
