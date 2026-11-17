import { useEffect, useState } from 'react'
import { ApiError, fetchAuthorizedBlob } from './api'
import { useAuth } from '../context/AuthContext'

export type AuthorizedAudioState = {
  blobUrl: string | null
  buffer: ArrayBuffer | null
  error: string | null
}

const EMPTY: AuthorizedAudioState = { blobUrl: null, buffer: null, error: null }

// El audio se pide con Authorization y se reproduce desde un blob URL.
// El objeto se revoca al desmontar o cuando cambia la fuente.
export function useAuthorizedAudio(src: string | null): AuthorizedAudioState {
  const { token, logout } = useAuth()
  const [state, setState] = useState<AuthorizedAudioState>(EMPTY)

  useEffect(() => {
    if (src === null || token === null) {
      setState(EMPTY)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    const controller = new AbortController()

    setState(EMPTY)
    void fetchAuthorizedBlob(src, token, controller.signal)
      .then(async (blob) => {
        const buffer = await blob.arrayBuffer()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ blobUrl: objectUrl, buffer, error: null })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        if (cause instanceof ApiError && cause.status === 401) {
          logout()
          return
        }
        setState({
          blobUrl: null,
          buffer: null,
          error: 'No se pudo cargar el audio. La grieta también informa.',
        })
      })

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [logout, src, token])

  return state
}
