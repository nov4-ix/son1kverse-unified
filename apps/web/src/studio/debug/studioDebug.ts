export type StudioDebugSnapshot = {
  activeAudioContexts: number
  activeCanvases: number
  createdAudioContexts: number
  createdCanvases: number
}

export type StudioDebug = {
  registerAudioContext: () => () => void
  registerCanvas: () => () => void
  snapshot: () => StudioDebugSnapshot
}

export function createStudioDebug(): StudioDebug {
  const state: StudioDebugSnapshot = {
    activeAudioContexts: 0,
    activeCanvases: 0,
    createdAudioContexts: 0,
    createdCanvases: 0,
  }

  const register = (audio: boolean): (() => void) => {
    if (!import.meta.env.DEV) return () => {}
    if (audio) {
      state.activeAudioContexts += 1
      state.createdAudioContexts += 1
    } else {
      state.activeCanvases += 1
      state.createdCanvases += 1
    }
    let released = false
    return () => {
      if (released) return
      released = true
      if (audio) state.activeAudioContexts = Math.max(0, state.activeAudioContexts - 1)
      else state.activeCanvases = Math.max(0, state.activeCanvases - 1)
    }
  }

  return {
    registerAudioContext: () => register(true),
    registerCanvas: () => register(false),
    snapshot: () => ({ ...state }),
  }
}

export const studioDebug = createStudioDebug()

export function installStudioDebug(): void {
  if (!import.meta.env.DEV) return
  window.__studioDebug = { snapshot: studioDebug.snapshot }
}
