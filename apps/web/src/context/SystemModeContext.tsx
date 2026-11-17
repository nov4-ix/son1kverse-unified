import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export type SystemMode = 'xentrix' | 'alvae';

interface SystemModeContextValue {
  mode: SystemMode;
  isTransitioning: boolean;
  targetMode: SystemMode;
  displayedProtocol: string;
  toggleMode: () => void;
  setMode: (next: SystemMode) => void;
  beginHold: () => void;
  endHold: () => void;
}

const SystemModeContext = createContext<SystemModeContextValue | null>(null);
const STORAGE_KEY = 'son1k_system_mode';

export const SystemModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<SystemMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'alvae' ? 'alvae' : 'xentrix';
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetMode, setTargetMode] = useState<SystemMode>(mode);
  const holdTimerRef = useRef<number | null>(null);

  const triggerTransition = useCallback((next: SystemMode) => {
    if (isTransitioning || next === mode) return;
    setTargetMode(next);
    setIsTransitioning(true);
    setTimeout(() => { setModeState(next); localStorage.setItem(STORAGE_KEY, next); }, 750);
    setTimeout(() => { setIsTransitioning(false); }, 1500);
  }, [isTransitioning, mode]);

  const toggleMode = useCallback(() => {
    triggerTransition(mode === 'xentrix' ? 'alvae' : 'xentrix');
  }, [mode, triggerTransition]);

  const beginHold = useCallback(() => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => { toggleMode(); }, 1500);
  }, [toggleMode]);

  const endHold = useCallback(() => {
    if (holdTimerRef.current !== null) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleMode(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode]);

  const displayedProtocol = mode === 'alvae' ? 'ctrl+ALT=humanity' : 'ctrl+alt=Security';

  return (
    <SystemModeContext.Provider value={{ mode, isTransitioning, targetMode, displayedProtocol, toggleMode, setMode: triggerTransition, beginHold, endHold }}>
      {children}
    </SystemModeContext.Provider>
  );
};

export const useSystemMode = (): SystemModeContextValue => {
  const ctx = useContext(SystemModeContext);
  if (!ctx) throw new Error('useSystemMode debe usarse dentro de SystemModeProvider');
  return ctx;
};
