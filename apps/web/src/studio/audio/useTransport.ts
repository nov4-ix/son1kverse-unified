import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { AudioEngine } from './audioEngine'
import { clampBpm } from '../lib/tempo'

export type StudioTransport = {
  isPlaying: boolean
  duration: number
  bpm: number
  numerator: number
  denominator: number
  positionRef: MutableRefObject<number>
  play: () => Promise<void>
  stop: () => void
  seek: (seconds: number) => void
  setBpm: (value: number) => void
  setTimeSignature: (numerator: number, denominator: number) => void
  subscribeFrame: (listener: (seconds: number) => void) => () => void
}

export function useTransport(engine: AudioEngine, buffer: AudioBuffer | null, initialBpm?: number): StudioTransport {
  const [bpm, setBpmState] = useState(() => clampBpm(initialBpm ?? 120))
  const [numerator, setNumerator] = useState(4)
  const [denominator, setDenominator] = useState(4)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const bpmTouchedRef = useRef(false)
  const positionRef = useRef(0)
  const listenersRef = useRef<Set<(seconds: number) => void>>(new Set())

  const notify = useCallback((seconds: number) => {
    positionRef.current = seconds
    listenersRef.current.forEach((listener) => listener(seconds))
  }, [])

  const subscribeFrame = useCallback(
    (listener: (seconds: number) => void) => {
      listenersRef.current.add(listener)
      listener(engine.getPosition())
      return () => {
        listenersRef.current.delete(listener)
      }
    },
    [engine],
  )

  useEffect(() => {
    if (bpmTouchedRef.current) return
    setBpmState(clampBpm(initialBpm ?? 120))
  }, [initialBpm])

  useEffect(() => {
    engine.load(buffer)
    positionRef.current = 0
    setDuration(engine.getDuration())
    setIsPlaying(false)
    if (buffer === null) engine.stop()
    notify(0)
  }, [buffer, engine, notify])

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      const seconds = engine.getPosition()
      positionRef.current = seconds
      listenersRef.current.forEach((listener) => listener(seconds))
      if (!engine.getIsPlaying()) {
        setIsPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine, isPlaying])

  useEffect(
    () => () => {
      listenersRef.current.clear()
    },
    [],
  )

  const play = useCallback(async () => {
    try {
      await engine.play()
    } catch {
      // El motor se descartó o cambió de buffer durante resume; no hay reproducción.
      setIsPlaying(false)
      notify(engine.getPosition())
      return
    }
    const playing = engine.getIsPlaying()
    setIsPlaying(playing)
    notify(engine.getPosition())
  }, [engine, notify])

  const stop = useCallback(() => {
    engine.stop()
    setIsPlaying(false)
    notify(engine.getPosition())
  }, [engine, notify])

  const seek = useCallback(
    (seconds: number) => {
      engine.seek(seconds)
      notify(engine.getPosition())
    },
    [engine, notify],
  )

  const setBpm = useCallback((value: number) => {
    bpmTouchedRef.current = true
    setBpmState(clampBpm(value))
  }, [])

  const setTimeSignature = useCallback((nextNumerator: number, nextDenominator: number) => {
    if (!Number.isInteger(nextNumerator) || nextNumerator < 1 || nextNumerator > 12) return
    if (nextDenominator !== 4 && nextDenominator !== 8) return
    setNumerator(nextNumerator)
    setDenominator(nextDenominator)
  }, [])

  return useMemo(
    () => ({
      isPlaying,
      duration,
      bpm,
      numerator,
      denominator,
      positionRef,
      play,
      stop,
      seek,
      setBpm,
      setTimeSignature,
      subscribeFrame,
    }),
    [bpm, denominator, duration, isPlaying, numerator, play, positionRef, seek, setBpm, setTimeSignature, stop, subscribeFrame],
  )
}
