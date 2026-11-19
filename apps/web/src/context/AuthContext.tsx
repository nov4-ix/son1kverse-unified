import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_SUBSCRIPTION_TIER, generationLimitForTier, storageLimitForTier } from '@son1k/shared-types'
import { api, ApiError, type AuthProfile, type AuthUser } from '../lib/api'

const TOKEN_KEY = 'son1k.authToken'

type AuthContextValue = {
  token: string | null
  user: AuthUser | null
  profile: AuthProfile | null
  error: string | null
  busy: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, alias: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<AuthProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applySession = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken)
    setUser(nextUser)
    try {
      window.sessionStorage.setItem(TOKEN_KEY, nextToken)
    } catch {
      /* ignore */
    }
    try {
      const nextProfile = await api.me(nextToken)
      setProfile(nextProfile)
    } catch {
      setProfile({
        user: {
          ...nextUser,
          generationsUsedThisMonth: 0,
          generationsLimit: generationLimitForTier(DEFAULT_SUBSCRIPTION_TIER),
          storageUsedBytes: 0,
          storageLimit: storageLimitForTier(DEFAULT_SUBSCRIPTION_TIER),
          subscriptionTier: DEFAULT_SUBSCRIPTION_TIER,
        },
        alvaeAccount: null,
      })
    }
  }, [])

  useEffect(() => {
    const stored = window.sessionStorage.getItem(TOKEN_KEY)
    if (stored === null) return
    void api.me(stored).then((nextProfile) => {
      setToken(stored)
      setUser(nextProfile.user)
      setProfile(nextProfile)
    }).catch(() => {
      window.sessionStorage.removeItem(TOKEN_KEY)
    })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      const session = await api.login(email, password)
      await applySession(session.token, session.user)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Login fallido')
    } finally {
      setBusy(false)
    }
  }, [applySession])

  const register = useCallback(async (email: string, alias: string, password: string) => {
    setBusy(true)
    setError(null)
    try {
      const session = await api.register(email, alias, password)
      await applySession(session.token, session.user)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registro fallido')
    } finally {
      setBusy(false)
    }
  }, [applySession])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setProfile(null)
    try {
      window.sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    token,
    user,
    profile,
    error,
    busy,
    login,
    register,
    logout,
  }), [busy, error, login, logout, profile, register, token, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
