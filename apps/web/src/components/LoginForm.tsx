import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

type LoginFormProps = {
  tone: 'xentrix' | 'alvae'
}

export function LoginForm({ tone }: LoginFormProps) {
  const { login, register, logout, user, busy, error } = useAuth()
  const [email, setEmail] = useState('')
  const [alias, setAlias] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')

  const field = tone === 'xentrix'
    ? 'w-full border border-xentrix-line bg-white px-3 py-2 text-sm text-xentrix-ink outline-none'
    : 'w-full border border-alvae-gold/30 bg-alvae-bg px-3 py-2 font-terminal text-sm text-alvae-ink outline-none'
  const button = tone === 'xentrix'
    ? 'border border-xentrix-ink px-4 py-2 text-xs uppercase tracking-[0.2em] text-xentrix-ink'
    : 'border border-alvae-gold px-4 py-2 font-terminal text-xs uppercase tracking-[0.2em] text-alvae-gold'

  if (user !== null) {
    return (
      <div className="flex items-center gap-3">
        <span className={tone === 'xentrix' ? 'text-xs text-xentrix-muted' : 'font-terminal text-xs text-alvae-muted'}>
          {user.alias}
        </span>
        <button type="button" className={button} onClick={logout}>Salir</button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (mode === 'login') {
          void login(email, password)
        } else {
          void register(email, alias, password)
        }
      }}
    >
      <input className={field} type="email" required placeholder="correo" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode === 'register' && (
        <input className={field} required placeholder="alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
      )}
      <input className={field} type="password" required minLength={mode === 'register' ? 12 : 1} placeholder={mode === 'register' ? 'clave (mín. 12)' : 'clave'} value={password} onChange={(e) => setPassword(e.target.value)} />
      {error !== null && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" className={button} disabled={busy}>
          {mode === 'login' ? 'Entrar' : 'Crear'}
        </button>
        <button
          type="button"
          className={tone === 'xentrix' ? 'text-[10px] uppercase tracking-[0.2em] text-xentrix-muted' : 'font-terminal text-[10px] uppercase tracking-[0.2em] text-alvae-muted'}
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Registro' : 'Ya tengo acceso'}
        </button>
      </div>
    </form>
  )
}
