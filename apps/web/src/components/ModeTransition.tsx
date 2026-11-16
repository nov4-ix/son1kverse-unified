import React, { useEffect, useState } from 'react';
import { useSystemMode } from '../context/SystemModeContext';
import { AlvaeSymbol } from '@son1k/shared-ui';

export const ModeTransition: React.FC = () => {
  const { isTransitioning, targetMode } = useSystemMode();
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [typedText, setTypedText] = useState('');

  const fullText = targetMode === 'alvae' ? 'ctrl+ALT=humanity' : 'ctrl+alt=Security';

  useEffect(() => {
    if (!isTransitioning) {
      setPhase(0);
      setTypedText('');
      return;
    }

    setPhase(1);
    const t1 = setTimeout(() => setPhase(2), 450);

    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedText(fullText.slice(0, index));
      if (index >= fullText.length) clearInterval(interval);
    }, 45);

    return () => {
      clearTimeout(t1);
      clearInterval(interval);
    };
  }, [isTransitioning, fullText]);

  if (!isTransitioning) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#060709] text-white select-none overflow-hidden">
      <div
        className={`absolute inset-x-0 top-0 bg-black transition-all duration-300 ${
          phase === 1 ? 'h-1/2' : 'h-0'
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 bg-black transition-all duration-300 ${
          phase === 1 ? 'h-1/2' : 'h-0'
        }`}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6 text-center font-mono">
        <div className={`transition-transform duration-500 ${phase === 2 ? 'scale-110 opacity-100' : 'scale-90 opacity-40'}`}>
          <AlvaeSymbol className="w-16 h-16 text-[#D4A359] drop-shadow-[0_0_18px_rgba(212,163,89,0.75)]" />
        </div>

        <div className="space-y-2">
          <div className="text-xs tracking-[0.35em] text-zinc-500 line-through decoration-red-500 decoration-2">
            {targetMode === 'alvae' ? 'SYS_PROTOCOL: ctrl+alt=Security' : 'SYS_PROTOCOL: ctrl+ALT=humanity'}
          </div>
          <div
            dir="rtl"
            className={`text-xl md:text-2xl font-bold tracking-[0.2em] ${
              targetMode === 'alvae' ? 'text-[#10B981]' : 'text-zinc-200'
            }`}
          >
            <span dir="ltr">{typedText}</span>
            <span className="animate-pulse text-[#D4A359]">_</span>
          </div>
        </div>

        <p className="text-[11px] uppercase tracking-[0.3em] text-[#D4A359]/80">
          {targetMode === 'alvae' ? '// LO IMPERFECTO TAMBIÉN ES SAGRADO' : '// RESTAURANDO FILTRO CORPORATIVO'}
        </p>
      </div>
    </div>
  );
};
