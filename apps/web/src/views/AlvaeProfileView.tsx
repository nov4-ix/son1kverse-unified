import { DEFAULT_SUBSCRIPTION_TIER, generationLimitForTier } from '@son1k/shared-types'
import { AlvaeSymbol } from '@son1k/shared-ui'
import { useState } from 'react'
import { LoginForm } from '../components/LoginForm'
import { AuthedAudio } from '../components/AuthedAudio'
import { useAuth } from '../context/AuthContext'
import { useStudio } from '../context/StudioContext'

export function AlvaeProfileView() {
  const { profile, user } = useAuth()
  const { lastJobId, lastAudioUrl, addRelease, releases } = useStudio()
  const [title, setTitle] = useState('Lanzamiento sin filtro')
  const [caption, setCaption] = useState('La Liga del No Silencio. Sector 7-Gris.')

  const alvae = profile?.alvaeAccount ?? null
  const used = profile?.user.generationsUsedThisMonth ?? 0
  const limit = profile?.user.generationsLimit ?? generationLimitForTier(DEFAULT_SUBSCRIPTION_TIER)

  return (
    <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="border border-alvae-gold/30 bg-alvae-panel p-6">
        <div className="flex items-start justify-between">
          <p className="font-terminal text-[11px] uppercase tracking-[0.32em] text-alvae-gold">
            Credencial ALVAE
          </p>
          <AlvaeSymbol className="h-12 w-12 text-alvae-gold" />
        </div>
        <h2 className="mt-6 font-terminal text-2xl text-alvae-ink">{user?.alias ?? 'sin sesión'}</h2>
        <p className="mt-2 font-terminal text-xs text-alvae-muted">{user?.email ?? 'entra para sellar la credencial'}</p>
        <dl className="mt-6 grid grid-cols-2 gap-4 font-terminal text-xs uppercase tracking-[0.16em] text-alvae-muted">
          <div>
            <dt>Tier</dt>
            <dd className="mt-1 text-alvae-gold">{alvae?.tier ?? 'sin credencial'}</dd>
          </div>
          <div>
            <dt>Rol</dt>
            <dd className="mt-1 text-alvae-ink">{alvae?.role ?? '—'}</dd>
          </div>
          <div>
            <dt>Símbolo</dt>
            <dd className="mt-1 text-alvae-terminal">{alvae?.alvaeSymbol ?? '◯⚡'}</dd>
          </div>
          <div>
            <dt>Cuota</dt>
            <dd className="mt-1 text-alvae-ink">{used}/{limit}</dd>
          </div>
        </dl>
        <div className="mt-8">
          <LoginForm tone="alvae" />
        </div>
      </div>

      <div className="space-y-5">
        <p className="font-terminal text-[11px] uppercase tracking-[0.32em] text-alvae-gold">
          Nova Post Pilot
        </p>
        <form
          className="space-y-3 border border-alvae-gold/20 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            addRelease(title, caption)
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full border border-alvae-gold/20 bg-alvae-bg px-3 py-2 font-terminal text-sm text-alvae-ink"
          />
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            className="h-24 w-full border border-alvae-gold/20 bg-alvae-bg p-3 font-terminal text-sm text-alvae-ink"
          />
          <button
            type="submit"
            disabled={lastJobId === null}
            className="border border-alvae-terminal px-4 py-2 font-terminal text-[10px] uppercase tracking-[0.22em] text-alvae-terminal disabled:opacity-40"
          >
            Registrar lanzamiento
          </button>
          <p className="font-terminal text-[10px] text-alvae-muted">
            El lanzamiento se ancla al último job real ({lastJobId ?? 'ninguno'}).
          </p>
        </form>
        <ul className="space-y-3">
          {releases.map((release) => (
            <li key={release.id} className="border border-alvae-gold/20 p-4">
              <p className="font-terminal text-sm text-alvae-gold">{release.title}</p>
              <p className="mt-1 font-terminal text-xs text-alvae-muted">{release.caption}</p>
              <AuthedAudio className="mt-3 w-full" src={release.audioUrl} />
            </li>
          ))}
        </ul>
        {lastAudioUrl !== null && releases.length === 0 && (
          <p className="font-terminal text-xs text-alvae-muted">Hay audio listo. Ponle título y lánzalo.</p>
        )}
      </div>
    </section>
  )
}
