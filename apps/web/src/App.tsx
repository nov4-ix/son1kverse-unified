import { ModeTransition } from './components/ModeTransition'
import { PixelNerve } from './components/PixelNerve'
import { AuthProvider } from './context/AuthContext'
import { StudioProvider } from './context/StudioContext'
import { SystemModeProvider, useSystemMode } from './context/SystemModeContext'
import { AlvaeConsole } from './views/AlvaeConsole'
import { XentrixLanding } from './views/XentrixLanding'

function Shell() {
  const { mode } = useSystemMode()
  return (
    <>
      <PixelNerve />
      <ModeTransition />
      {mode === 'xentrix' ? <XentrixLanding /> : <AlvaeConsole />}
    </>
  )
}

export function App() {
  return (
    <SystemModeProvider>
      <AuthProvider>
        <StudioProvider>
          <Shell />
        </StudioProvider>
      </AuthProvider>
    </SystemModeProvider>
  )
}
