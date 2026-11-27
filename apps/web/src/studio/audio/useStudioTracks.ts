import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchAuthorizedBlob } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { computePeaks } from '../lib/peaks'
import type { AudioEngine } from './audioEngine'
import type { StudioTrack, StudioTrackSource } from './types'

export type StudioTracksState = {
  tracks: StudioTrack[]
  masterBuffer: AudioBuffer | null
  loading: boolean
  error: string | null
  warnings: string[]
}

const EMPTY: StudioTracksState = { tracks: [], masterBuffer: null, loading: false, error: null, warnings: [] }

function orderTracks(sources: StudioTrackSource[], cache: Map<string, StudioTrack>): StudioTrack[] {
  const tracks: StudioTrack[] = []
  for (const source of sources) {
    const track = cache.get(source.url)
    if (track) tracks.push(track)
  }
  return tracks
}

// Descarga, decodifica y calcula peaks una sola vez por URL.
// Los stems se añaden sin recargar ni detener el master ya cargado.
export function useStudioTracks(engine: AudioEngine, sources: StudioTrackSource[]): StudioTracksState {
  const { token, logout } = useAuth()
  const [state, setState] = useState<StudioTracksState>(EMPTY)
  const cacheRef = useRef<Map<string, StudioTrack>>(new Map())
  const key = sources.map((source) => source.url).join('|')
  const stableSources = useMemo(() => sources, [key])

  useEffect(() => {
    if (stableSources.length === 0 || token === null) {
      cacheRef.current.clear()
      setState(EMPTY)
      return
    }

    const missing = stableSources.filter((source) => !cacheRef.current.has(source.url))
    if (missing.length === 0) {
      const tracks = orderTracks(stableSources, cacheRef.current)
      const master = tracks.find((track) => track.id === 'master') ?? null
      setState({ tracks, masterBuffer: master?.buffer ?? null, loading: false, error: null, warnings: [] })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const activeIds = new Set(stableSources.map((source) => source.id))
    setState((previous) => {
      const tracks = previous.tracks.filter((track) => activeIds.has(track.id))
      const master = tracks.find((track) => track.id === 'master') ?? null
      return { tracks, masterBuffer: master?.buffer ?? null, loading: true, error: null, warnings: [] }
    })

    void (async () => {
      const results = await Promise.allSettled(
        missing.map(async (source) => {
          const blob = await fetchAuthorizedBlob(source.url, token, controller.signal)
          const data = await blob.arrayBuffer()
          if (cancelled || controller.signal.aborted) throw new Error('cancelled')
          const buffer = await engine.decode(data)
          if (cancelled) throw new Error('cancelled')
          const peaks = computePeaks(buffer.getChannelData(0), 2048)
          return { ...source, buffer, peaks, duration: buffer.duration }
        }),
      )
      if (cancelled) return

      const warnings: string[] = []
      let error: string | null = null
      results.forEach((result, index) => {
        const source = missing[index]
        if (!source) return
        if (result.status === 'fulfilled') {
          cacheRef.current.set(source.url, result.value)
          return
        }
        if (result.reason instanceof ApiError && result.reason.status === 401) logout()
        if (source.id === 'master') error = 'No se pudo cargar el master.'
        else warnings.push(`No se pudo cargar el stem ${source.label}.`)
      })

      const activeUrls = new Set(stableSources.map((source) => source.url))
      for (const url of Array.from(cacheRef.current.keys())) {
        if (!activeUrls.has(url)) cacheRef.current.delete(url)
      }

      const tracks = orderTracks(stableSources, cacheRef.current)
      const master = tracks.find((track) => track.id === 'master') ?? null
      setState({ tracks, masterBuffer: master?.buffer ?? null, loading: false, error, warnings })
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [engine, key, logout, stableSources, token])

  return state
}
