import { SUBSCRIPTION_PLANS } from '@son1k/shared-types'
import { AlvaeSymbol, LiteraryKnob, PlatformLogo } from '@son1k/shared-ui'
import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { AuthedAudio } from '../components/AuthedAudio'
import { useStudio } from '../context/StudioContext'
import { useSystemMode } from '../context/SystemModeContext'
import { orchestrateAandR } from '../lib/pixelAandR'
import type { QualityPreset } from '../lib/api'

const PLANS = SUBSCRIPTION_PLANS
const PAID_TIERS = new Set(['STARTER', 'PRO', 'ENTERPRISE'])

export function ClassicHubView() {
  const { user, logout } = useAuth()
  const { displayedProtocol, beginHold, endHold } = useSystemMode()
  const { knobs, setKnob, generate, busy, error, lastAudioUrl, jobStatus, releases, generations, generationsLoading, refreshGenerations, setView, pixelSignal } = useStudio()
  const [prompt, setPrompt] = useState('')
  const [styleHint, setStyleHint] = useState('')
  const [isInstrumental, setIsInstrumental] = useState(false)
  const [isBoost, setIsBoost] = useState(false)
  const [upgradeNotice, setUpgradeNotice] = useState<string | null>(null)
  const [voiceType, setVoiceType] = useState<'male' | 'female' | null>(null)
  const [showKnobs, setShowKnobs] = useState(false)
  const [joined, setJoined] = useState(false)

  const userTier = String((user as { tier?: string; alvaeCredential?: { tier?: string } } | null)?.alvaeCredential?.tier ?? (user as { tier?: string } | null)?.tier ?? 'FREE').toUpperCase()
  const canUseXl = PAID_TIERS.has(userTier)
  const selectedPreset: QualityPreset = isBoost && canUseXl ? 'xl_turbo' : 'turbo'

  const handleToggleBoost = () => {
    if (!isBoost && !canUseXl) {
      setUpgradeNotice('XL Turbo requiere un plan de pago (STARTER, PRO o ENTERPRISE). Se mantendrá el preset 1.5 Turbo.')
      return
    }
    setUpgradeNotice(null)
    setIsBoost((prev) => !prev)
  }

  const composed = useMemo(() => {
    const p = [prompt.trim() || 'Balada electrónica nocturna con sintetizadores analógicos']
    if (styleHint.trim()) p.push('Estilo: ' + styleHint.trim())
    if (isInstrumental) p.push('[Instrumental]')
    else if (voiceType === 'male') p.push('[Voz Masculina]')
    else if (voiceType === 'female') p.push('[Voz Femenina]')
    return p.join(' · ')
  }, [prompt, styleHint, isInstrumental, voiceType])

  const dir = useMemo(() => orchestrateAandR(composed, isInstrumental ? '' : prompt, knobs, releases.length), [composed, isInstrumental, prompt, knobs, releases.length])
  const min = Math.floor(dir.duration_s / 60)
  const sec = String(dir.duration_s % 60).padStart(2, '0')

  return (
    <div className="min-h-screen bg-[#0B0E14] text-zinc-100 pb-28">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0E14]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button type="button" onMouseDown={beginHold} onMouseUp={endHold} onMouseLeave={endHold} onTouchStart={beginHold} onTouchEnd={endHold} className="flex items-center gap-3 text-left">
            <PlatformLogo className="h-9 w-9 text-[#D4A359]" />
            <div><div className="font-bold tracking-wider text-white">SON1KVERS3</div><div className="font-mono text-[10px] text-emerald-400">MUSIC GENERATION PLATFORM V3</div></div>
          </button>
          <nav className="hidden md:flex items-center gap-6 font-mono text-xs tracking-widest text-zinc-400">
            <a href="#generator" className="hover:text-white">GENERATOR</a><a href="#archivo" className="hover:text-white">ARCHIVO</a><a href="#tools" className="hover:text-white">TOOLS</a><a href="#planes" className="hover:text-white">PLANES</a>
          </nav>
          <div className="flex items-center gap-3">
            {user && <span className="inline-flex items-center gap-1 border border-[#D4A359]/40 bg-[#D4A359]/10 px-2 py-1 font-mono text-[10px] text-[#D4A359]"><AlvaeSymbol className="h-3.5 w-3.5" /> {user.alias}</span>}
            <span className="hidden sm:inline font-mono text-[11px] text-emerald-400">{displayedProtocol}</span>
            {user && <button type="button" onClick={logout} className="border border-white/15 px-3 py-1 font-mono text-xs text-zinc-300">Salir</button>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 pt-12 space-y-20">
        <section id="generator" className="space-y-8">
          <div className="flex flex-col items-center text-center space-y-3">
            <PlatformLogo className="h-20 w-20 text-[#D4A359]" />
            <h1 className="font-mono text-3xl md:text-5xl font-extrabold tracking-[0.22em] bg-gradient-to-r from-[#B858FE] via-[#047AF6] to-[#40FDAE] bg-clip-text text-transparent">[SON1KVERS3]</h1>
            <p className="font-mono text-lg text-sky-400">Ctrl+Alt= Humanity</p>
            <p className="font-mono text-xs text-emerald-400">PIXEL A&amp;R: {pixelSignal}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121722] p-6 md:p-8 space-y-6">
            <div><label className="block text-sm font-medium text-zinc-200 mb-2">Describe tu canción</label><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe la atmósfera, emoción o historia..." className="h-28 w-full rounded-lg border border-white/10 bg-[#0B0E14] p-4 text-sm text-white outline-none" /></div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0B0E14]/80 px-4 py-3">
                <div><div className="text-sm font-medium">Instrumental</div><div className="text-xs text-zinc-400">Generar canción sin letra</div></div>
                <button type="button" onClick={() => setIsInstrumental(!isInstrumental)} className={isInstrumental ? 'h-6 w-11 rounded-full bg-emerald-500' : 'h-6 w-11 rounded-full bg-zinc-700'}><span className={isInstrumental ? 'block h-4 w-4 rounded-full bg-white translate-x-6' : 'block h-4 w-4 rounded-full bg-white translate-x-1'} /></button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0B0E14]/80 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">Boost Mode <span className="rounded bg-purple-600/30 px-1.5 py-0.5 font-mono text-[10px] text-purple-300">{selectedPreset === 'xl_turbo' ? 'XL TURBO' : '1.5 TURBO'}</span></div>
                  <div className="text-xs text-zinc-400">Preset {selectedPreset === 'xl_turbo' ? 'xl_turbo' : 'turbo'} · Masterización LUFS</div>
                </div>
                <button type="button" onClick={handleToggleBoost} className={isBoost && canUseXl ? 'h-6 w-11 rounded-full bg-purple-500' : 'h-6 w-11 rounded-full bg-zinc-700'}><span className={isBoost && canUseXl ? 'block h-4 w-4 rounded-full bg-white translate-x-6' : 'block h-4 w-4 rounded-full bg-white translate-x-1'} /></button>
              </div>
              {upgradeNotice && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 font-mono text-xs text-amber-300 flex items-center justify-between gap-3">
                  <span>{upgradeNotice}</span>
                  <a href="#planes" className="underline whitespace-nowrap text-amber-200">Ver planes</a>
                </div>
              )}
            </div>
            {!isInstrumental && (
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setVoiceType(voiceType === 'male' ? null : 'male')} className={voiceType === 'male' ? 'rounded-lg border border-sky-400 bg-sky-500/15 p-3.5 text-left' : 'rounded-lg border border-white/10 bg-[#0B0E14]/70 p-3.5 text-left'}><div className="text-sm font-medium">Voz Masculina</div><div className="text-xs text-zinc-400">Tono grave y profundo</div></button>
                <button type="button" onClick={() => setVoiceType(voiceType === 'female' ? null : 'female')} className={voiceType === 'female' ? 'rounded-lg border border-emerald-400 bg-emerald-500/15 p-3.5 text-left' : 'rounded-lg border border-white/10 bg-[#0B0E14]/70 p-3.5 text-left'}><div className="text-sm font-medium">Voz Femenina</div><div className="text-xs text-zinc-400">Tono agudo y claro</div></button>
              </div>
            )}
            <input type="text" value={styleHint} onChange={(e) => setStyleHint(e.target.value)} placeholder="Estilo musical (opcional)..." className="w-full rounded-lg border border-white/10 bg-[#0B0E14] px-4 py-3 text-sm text-white outline-none" />
            <div className="rounded-lg border border-[#D4A359]/25 bg-[#0B0E14]/90 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                <span className="text-[#D4A359]">ORQUESTACIÓN A&amp;R: {dir.bpm} BPM · {dir.key} · {min}:{sec}</span>
                <button type="button" onClick={() => setShowKnobs(!showKnobs)} className="text-emerald-400 underline">{showKnobs ? 'Ocultar Perillas' : 'Calibrar 4 Perillas + Quinto Acorde'}</button>
              </div>
              <p className="font-mono text-[11px] text-zinc-400">{dir.structure.join(' → ')}</p>
              {showKnobs && (
                <div className="pt-4 border-t border-white/10 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <LiteraryKnob label="Intensidad" hint="Canon → ruptura" value={knobs.creativeIntensity} onChange={(v) => setKnob('creativeIntensity', v)} />
                    <LiteraryKnob label="Emoción" hint="Superficie → herida" value={knobs.emotionalDepth} onChange={(v) => setKnob('emotionalDepth', v)} accent="#10B981" />
                    <LiteraryKnob label="Experimental" hint="Orden → grieta" value={knobs.experimentalLevel} onChange={(v) => setKnob('experimentalLevel', v)} accent="#F59E0B" />
                    <LiteraryKnob label="Narrativa" hint="Paisaje → fábula" value={knobs.narrativeStyle} onChange={(v) => setKnob('narrativeStyle', v)} />
                  </div>
                  <input type="range" min={0} max={1} step={0.01} value={knobs.humanImperfection} onChange={(e) => setKnob('humanImperfection', Number(e.target.value))} className="w-full accent-[#D4A359]" />
                </div>
              )}
            </div>
            <button type="button" disabled={busy} onClick={() => void generate({ prompt: composed, lyrics: isInstrumental ? '' : prompt, qualityPreset: selectedPreset })} className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 py-4 font-bold text-sm text-zinc-950 disabled:opacity-40">{busy ? 'Sintetizando (' + jobStatus + ')...' : '✦ Generar Canción'}</button>
            {error && <p className="text-center font-mono text-xs text-red-400">{error}</p>}
          </div>
        </section>
        <section id="archivo" className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-white">El Archivo</h2>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void refreshGenerations()} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-300 hover:text-white">Actualizar</button>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400">{generations.length > 0 ? `${generations.length} piezas` : 'Sin lanzamientos'}</span>
            </div>
          </div>
          {generationsLoading ? (
            <div className="rounded-xl border border-white/10 bg-[#121722] px-6 py-10 text-center font-mono text-xs text-zinc-400">Cargando historial de generaciones...</div>
          ) : generations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-[#121722] px-6 py-12 text-center space-y-3">
              <p className="font-mono text-sm text-zinc-300">Todavía no hay lanzamientos en tu archivo.</p>
              <p className="mx-auto max-w-lg font-mono text-[11px] text-zinc-500">Cuando generes una canción aparecerá aquí con su audio real. No mostramos piezas de ejemplo como si fueran tuyas.</p>
              <button type="button" onClick={() => setView('generator')} className="rounded-lg border border-[#D4A359]/40 bg-[#D4A359]/10 px-4 py-2 font-mono text-xs text-[#D4A359]">Abrir el generador</button>
            </div>
          ) : (
            <div className="grid gap-4">
              {generations.map((item) => {
                const presetLabel = item.qualityPreset === 'xl_turbo' ? 'XL Turbo' : '1.5 Turbo'
                const metaParts = [
                  item.bpm ? `${item.bpm} BPM` : null,
                  item.musicalKey ?? null,
                  item.durationS ? `${item.durationS}s` : null,
                  item.modelVersion ?? null,
                ].filter(Boolean)
                return (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-[#121722] p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="rounded bg-[#D4A359]/15 px-2 py-0.5 text-[#D4A359]">{presetLabel}</span>
                        <span className="rounded bg-white/10 px-2 py-0.5 uppercase text-zinc-200">{item.status}</span>
                      </div>
                      <span className="font-mono text-[11px] text-zinc-500">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-zinc-100">{item.prompt}</p>
                    {metaParts.length > 0 && <p className="font-mono text-[11px] text-zinc-400">{metaParts.join(' · ')}</p>}
                    {item.audioUrl && <AuthedAudio src={item.audioUrl} className="h-9 w-full" />}
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-emerald-500/30 bg-[#121722] p-8 text-center space-y-4">
          <span className="inline-block rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[11px] text-emerald-400">Próximamente</span>
          <h2 className="text-2xl font-bold text-white">El Santuario</h2>
          <p className="mx-auto max-w-xl text-sm text-zinc-400">Un espacio sagrado donde cada voz imperfecta encuentra su lugar.</p>
          <button type="button" onClick={() => setJoined(true)} className="rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold text-white">{joined ? '✓ Inscrito en La Liga del No Silencio' : 'Únete a la lista de espera'}</button>
        </section>
        <section id="tools" className="space-y-6">
          <h2 className="text-2xl font-bold text-center text-white">Herramientas Creativas</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <button type="button" onClick={() => setView('generator')} className="rounded-xl border border-white/10 bg-[#121722] p-6 text-left"><div className="font-bold">The Generator</div><div className="mt-1 text-xs text-zinc-400">Consola con 4 Perillas Literarias</div></button>
            <button type="button" onClick={() => setView('ghost')} className="rounded-xl border border-white/10 bg-[#121722] p-6 text-left"><div className="font-bold">Ghost Studio</div><div className="mt-1 text-xs text-zinc-400">Repainting, covers y stems</div></button>
            <button type="button" onClick={() => setView('nova')} className="rounded-xl border border-white/10 bg-[#121722] p-6 text-left"><div className="font-bold">Nova Post Pilot</div><div className="mt-1 text-xs text-zinc-400">Lanzamientos y credencial ALVAE</div></button>
          </div>
        </section>
        <section id="planes" className="space-y-6">
          <h2 className="text-2xl font-bold text-center text-white">Elige tu plan</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div key={plan.tier} className={plan.highlighted ? 'rounded-xl border border-purple-500 bg-[#161B29] p-6 flex flex-col justify-between' : 'rounded-xl border border-white/10 bg-[#121722] p-6 flex flex-col justify-between'}>
                <div className="space-y-2">
                  <div className="font-bold text-white">{plan.name}</div>
                  <div className="text-2xl font-bold text-white">{plan.priceLabel}<span className="text-xs font-normal text-zinc-400">{plan.period}</span></div>
                  <p className="text-xs text-zinc-400">{plan.description}</p>
                  <ul className="space-y-1 pt-2 text-xs text-zinc-300">{plan.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
                </div>
                <button type="button" className={plan.highlighted ? 'mt-6 w-full rounded-lg bg-purple-600 py-2.5 text-xs font-semibold text-white' : 'mt-6 w-full rounded-lg bg-white/10 py-2.5 text-xs font-semibold text-white'}>Comenzar ahora</button>
              </div>
            ))}
          </div>
        </section>
        <footer className="border-t border-white/10 pt-8 text-center space-y-2"><div className="font-bold text-white">Son1kvers3</div><div className="font-mono text-xs text-[#D4A359]">Lo imperfecto también es sagrado</div></footer>
      </main>
      {lastAudioUrl && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D4A359]/40 bg-[#0B0E14]/95 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-4"><span className="font-mono text-xs text-[#D4A359]">MASTER ({min}:{sec})</span><AuthedAudio src={lastAudioUrl} className="h-9 flex-1" /></div>
        </div>
      )}
    </div>
  )
}
