import { AlvaeSymbol, PlatformLogo } from '@son1k/shared-ui'
import { useSystemMode } from '../context/SystemModeContext'
import { useStudio, type ConsoleView } from '../context/StudioContext'
import { AlvaeProfileView } from './AlvaeProfileView'
import { GeneratorView } from './GeneratorView'
import { GhostStudioView } from './GhostStudioView'

const NAV: { id: ConsoleView; label: string }[] = [
  { id: 'generator', label: 'La Terminal' },
  { id: 'ghost', label: 'Ghost Studio' },
  { id: 'nova', label: 'Nova / ALVAE' },
]

export function AlvaeConsole() {
  const { displayedProtocol, beginHold, endHold } = useSystemMode()
  const { view, setView, pixelSignal } = useStudio()

  return (
    <div className="alvae-grain min-h-screen bg-alvae-bg text-alvae-ink">
      <header className="ml-6 flex items-center justify-between border-b border-alvae-gold/20 px-6 py-5 md:ml-14">
        <button
          type="button"
          className="flex items-center gap-3"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
        >
          <PlatformLogo className="h-8 w-8 text-alvae-gold" />
          <span className="font-terminal text-[11px] uppercase tracking-[0.36em] text-alvae-gold">
            SON1KVERSE
          </span>
        </button>
        <nav className="flex gap-4">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`font-terminal text-[10px] uppercase tracking-[0.24em] ${
                view === item.id ? 'text-alvae-terminal' : 'text-alvae-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <AlvaeSymbol className="h-7 w-7 text-alvae-gold" />
      </header>

      <main className="ml-6 px-6 py-8 md:ml-14">
        {view === 'generator' && <GeneratorView />}
        {view === 'ghost' && <GhostStudioView />}
        {view === 'nova' && <AlvaeProfileView />}
      </main>

      <footer className="ml-6 flex items-center justify-between px-6 py-5 font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-muted md:ml-14">
        <span>SYS_PROTOCOL: {displayedProtocol}</span>
        <span className="text-alvae-terminal">{pixelSignal}</span>
        <span>La Liga del No Silencio</span>
      </footer>
    </div>
  )
}
