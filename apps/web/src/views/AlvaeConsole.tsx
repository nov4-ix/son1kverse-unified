import { useStudio } from '../context/StudioContext'
import { PixelNerve } from '../components/PixelNerve'
import { ClassicHubView } from './ClassicHubView'
import { GhostStudioView } from './GhostStudioView'
import { AlvaeProfileView } from './AlvaeProfileView'

export function AlvaeConsole() {
  const { view, setView } = useStudio()

  if (view === 'generator') {
    return (
      <>
        <PixelNerve />
        <ClassicHubView />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-alvae-bg text-alvae-ink">
      <PixelNerve />
      <header className="border-b border-alvae-gold/20 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <button type="button" onClick={() => setView('generator')} className="font-terminal text-xs uppercase tracking-[0.25em] text-alvae-gold">
            ← Volver a SON1KVERS3 Hub
          </button>
          <div className="flex gap-4 font-terminal text-xs uppercase tracking-widest">
            <button type="button" onClick={() => setView('ghost')} className={view === 'ghost' ? 'text-alvae-terminal' : 'text-alvae-muted'}>Ghost Studio</button>
            <button type="button" onClick={() => setView('nova')} className={view === 'nova' ? 'text-alvae-terminal' : 'text-alvae-muted'}>Nova &amp; ALVAE</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        {view === 'ghost' ? <GhostStudioView /> : <AlvaeProfileView />}
      </main>
    </div>
  )
}
