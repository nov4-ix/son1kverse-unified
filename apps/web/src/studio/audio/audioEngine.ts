import { studioDebug } from '../debug/studioDebug'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private startedAt = 0
  private startOffset = 0
  private position = 0
  private playing = false
  private generation = 0
  private releaseDebug: (() => void) | null = null

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      if (import.meta.env.DEV) this.releaseDebug = studioDebug.registerAudioContext()
      this.gain = this.ctx.createGain()
      this.gain.connect(this.ctx.destination)
    }
    return this.ctx
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ensureContext().decodeAudioData(data.slice(0))
  }

  load(buffer: AudioBuffer | null): void {
    if (this.playing) this.stop()
    this.buffer = buffer
    this.position = 0
    this.startOffset = 0
    this.startedAt = 0
  }

  async play(): Promise<void> {
    const buffer = this.buffer
    if (!buffer) return
    const ctx = this.ensureContext()
    await ctx.resume()
    if (this.ctx !== ctx || this.buffer !== buffer) return
    if (this.playing) return
    if (this.position >= buffer.duration) this.position = 0
    this.startSource(this.position)
  }

  stop(): void {
    this.generation += 1
    this.stopSource()
    if (this.playing) this.position = this.getPosition()
    this.playing = false
  }

  seek(seconds: number): void {
    const duration = this.getDuration()
    const safe = Number.isFinite(seconds) ? seconds : 0
    const next = Math.min(duration, Math.max(0, safe))
    this.position = next
    this.startOffset = next
    if (this.playing) {
      this.stopSource()
      this.startSource(next)
    }
  }

  getPosition(): number {
    if (!this.playing || !this.ctx) return this.position
    const elapsed = this.ctx.currentTime - this.startedAt
    return Math.min(this.getDuration(), Math.max(0, this.startOffset + elapsed))
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0
  }

  getIsPlaying(): boolean {
    return this.playing
  }

  getContextState(): AudioContextState | 'uninitialized' {
    return this.ctx?.state ?? 'uninitialized'
  }

  dispose(): void {
    this.stop()
    this.source = null
    if (this.gain) {
      this.gain.disconnect()
      this.gain = null
    }
    const ctx = this.ctx
    this.ctx = null
    this.buffer = null
    this.position = 0
    this.startedAt = 0
    this.startOffset = 0
    this.generation += 1
    if (this.releaseDebug) {
      this.releaseDebug()
      this.releaseDebug = null
    }
    if (ctx) void ctx.close()
  }

  private startSource(offset: number): void {
    if (!this.buffer) return
    const ctx = this.ensureContext()
    const source = ctx.createBufferSource()
    source.buffer = this.buffer
    if (this.gain) source.connect(this.gain)
    const generation = ++this.generation
    source.onended = () => {
      if (generation !== this.generation) return
      this.source = null
      this.playing = false
      this.position = this.buffer?.duration ?? this.position
      this.startOffset = this.position
      this.startedAt = 0
    }
    source.start(0, Math.min(offset, this.buffer.duration))
    this.source = source
    this.startedAt = ctx.currentTime
    this.startOffset = offset
    this.position = offset
    this.playing = true
  }

  private stopSource(): void {
    if (!this.source) return
    const source = this.source
    this.source = null
    source.onended = null
    try {
      source.stop()
    } catch {
      // La fuente ya terminó; no hay nada que detener.
    }
    source.disconnect()
  }
}
