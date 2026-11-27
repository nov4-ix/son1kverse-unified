import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './audioEngine'

class FakeSourceNode {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  connect() {}
  disconnect() {}
  start = vi.fn()
  stop = vi.fn()
}

class FakeGainNode {
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'suspended' as AudioContextState
  currentTime = 0
  destination = {} as AudioDestinationNode
  sources: FakeSourceNode[] = []
  resumeResolve: () => void = () => {}
  private resumePromise: Promise<void> = Promise.resolve()

  constructor() {
    FakeAudioContext.instances.push(this)
    this.resumePromise = new Promise((resolve) => {
      this.resumeResolve = resolve
    })
  }

  resume(): Promise<void> {
    this.state = 'running'
    return this.resumePromise
  }

  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }

  createGain() {
    return new FakeGainNode()
  }

  createBufferSource() {
    const source = new FakeSourceNode()
    this.sources.push(source)
    return source
  }

  decodeAudioData() {
    return Promise.reject(new Error('no usado en este test'))
  }
}

function fakeBuffer(duration: number): AudioBuffer {
  return { duration } as AudioBuffer
}

function installFakeAudioContext(): void {
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

describe('AudioEngine lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeAudioContext.instances = []
  })

  it('no arranca una fuente si el buffer se descarga durante resume', async () => {
    installFakeAudioContext()
    const engine = new AudioEngine()
    engine.load(fakeBuffer(10))

    const playing = engine.play()
    const context = FakeAudioContext.instances[0]
    if (!context) throw new Error('contexto no creado')
    engine.load(null)
    context.resumeResolve()

    await expect(playing).resolves.toBeUndefined()
    expect(context.sources).toHaveLength(0)
    expect(engine.getIsPlaying()).toBe(false)
    engine.dispose()
  })

  it('no lanza si el motor se descarta durante resume', async () => {
    installFakeAudioContext()
    const engine = new AudioEngine()
    engine.load(fakeBuffer(10))

    const playing = engine.play()
    const context = FakeAudioContext.instances[0]
    if (!context) throw new Error('contexto no creado')
    engine.dispose()
    context.resumeResolve()

    await expect(playing).resolves.toBeUndefined()
  })

  it('arranca la fuente tras resume cuando el buffer sigue vigente', async () => {
    installFakeAudioContext()
    const engine = new AudioEngine()
    engine.load(fakeBuffer(10))

    const playing = engine.play()
    const context = FakeAudioContext.instances[0]
    if (!context) throw new Error('contexto no creado')
    context.resumeResolve()
    await playing

    expect(context.sources).toHaveLength(1)
    expect(context.sources[0]?.start).toHaveBeenCalled()
    expect(engine.getIsPlaying()).toBe(true)
    engine.dispose()
  })
})
