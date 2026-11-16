import { PlatformLogo } from '@son1k/shared-ui'
import { LoginForm } from '../components/LoginForm'
import { useSystemMode } from '../context/SystemModeContext'

export function XentrixLanding() {
  const { displayedProtocol, beginHold, endHold } = useSystemMode()

  return (
    <div className="xentrix-grid min-h-screen bg-xentrix-bg text-xentrix-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-8 py-8">
        <button
          type="button"
          className="flex items-center gap-3"
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          aria-label="SON1KVERSE"
        >
          <PlatformLogo className="h-9 w-9 text-[#B0893A]" />
          <span className="text-[11px] font-medium uppercase tracking-[0.42em]">SON1KVERSE</span>
        </button>
        <span className="text-[10px] uppercase tracking-[0.28em] text-xentrix-muted">XentriX Systems</span>
      </header>

      <main className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center px-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.5em] text-xentrix-muted">Optimización Sonora Algorítmica</p>
        <h1 className="mt-6 max-w-3xl text-4xl font-light tracking-tight md:text-6xl">
          Canciones sin cicatrices
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-6 text-xentrix-muted">
          Plataforma clínica de generación sonora. Simetría, latencia mínima y un resultado
          estéril. El ruido humano se considera un defecto de proceso.
        </p>
        <div className="mt-12 w-full max-w-xs">
          <LoginForm tone="xentrix" />
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-8 py-6 text-[10px] uppercase tracking-[0.22em] text-xentrix-muted">
        <span>SYS_PROTOCOL: {displayedProtocol}</span>
        <span>Sector 7-Gris / Pág. 143</span>
      </footer>
    </div>
  )
}
